const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

app.use(cors());
app.use(express.json());

const API_URL = 'https://swtenet.com/live/api_ultimas_ubicaciones.php';

let lastEmittedData = null;
let updateInterval = null;
let activeClients = 0;

// ============================================
// FUNCIÓN: Obtener ubicaciones desde tu API PHP
// ============================================
async function getCurrentLocations() {
    try {
        const response = await fetch(API_URL);
        
        if (!response.ok) {
            console.error(`❌ API respondió con status: ${response.status}`);
            return [];
        }
        
        const data = await response.json();
        
        if (data.success && data.empleados) {
            console.log(`📡 API devolvió ${data.empleados.length} empleados`);
            return data.empleados;
        } else {
            return [];
        }
    } catch (error) {
        console.error('❌ Error consultando API:', error.message);
        return [];
    }
}

// ============================================
// FUNCIÓN: Verificar cambios y emitir
// ============================================
async function checkAndEmitUpdates() {
    // Si no hay clientes, no hacer nada
    if (activeClients === 0) {
        return;
    }
    
    try {
        const locations = await getCurrentLocations();
        
        if (locations.length === 0) {
            return;
        }
        
        const currentDataStr = JSON.stringify(locations);
        const lastDataStr = lastEmittedData ? JSON.stringify(lastEmittedData) : null;
        
        if (currentDataStr !== lastDataStr) {
            lastEmittedData = locations;
            io.emit('locations_update', locations);
            console.log(`📤 Emitidas ${locations.length} ubicaciones a ${activeClients} clientes`);
        }
    } catch (error) {
        console.error('❌ Error en checkAndEmitUpdates:', error.message);
    }
}

// ============================================
// INICIAR / DETENER MONITOREO
// ============================================
function startMonitoring() {
    if (updateInterval) {
        clearInterval(updateInterval);
    }
    
    // Verificar cambios cada 3 segundos
    updateInterval = setInterval(checkAndEmitUpdates, 3000);
    console.log('🔄 Monitoreo iniciado (intervalo: 3s)');
}

function stopMonitoring() {
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
        console.log('⏹️ Monitoreo detenido (sin clientes)');
    }
}

// ============================================
// ENDPOINTS REST
// ============================================

// Endpoint para obtener ubicaciones (carga inicial)
app.get('/api/ubicaciones', async (req, res) => {
    try {
        const locations = await getCurrentLocations();
        res.json({
            success: true,
            empleados: locations,
            total: locations.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Error al obtener ubicaciones'
        });
    }
});

// Endpoint de salud
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        clients_connected: activeClients,
        api_url: API_URL,
        monitoring: updateInterval ? 'activo' : 'detenido',
        last_emitted: lastEmittedData ? `${lastEmittedData.length} empleados` : 'ninguno'
    });
});

// ============================================
// SOCKET.IO - CONEXIONES DE CLIENTES
// ============================================

io.on('connection', (socket) => {
    activeClients++;
    console.log(`👤 Cliente conectado: ${socket.id} (Total: ${activeClients})`);
    
    // Si es el primer cliente, iniciar monitoreo
    if (activeClients === 1) {
        startMonitoring();
    }
    
    // Enviar datos iniciales
    (async () => {
        try {
            const locations = await getCurrentLocations();
            socket.emit('initial_locations', locations);
            console.log(`📤 Enviados ${locations.length} empleados a ${socket.id}`);
            
            if (locations.length > 0) {
                lastEmittedData = locations;
            }
        } catch (error) {
            console.error('❌ Error enviando datos iniciales:', error.message);
            socket.emit('error', { 
                message: 'Error al cargar datos iniciales',
                details: error.message
            });
        }
    })();

    socket.on('disconnect', () => {
        activeClients--;
        console.log(`👤 Cliente desconectado: ${socket.id} (Total: ${activeClients})`);
        
        // Si no quedan clientes, detener monitoreo
        if (activeClients === 0) {
            stopMonitoring();
        }
    });
});

// ============================================
// INICIAR SERVIDOR
// ============================================

async function startServer() {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`========================================`);
        console.log(`🚀 Servidor WebSocket corriendo`);
        console.log(`📡 URL: https://gps-ws.onrender.com`);
        console.log(`📡 API: ${API_URL}`);
        console.log(`📡 Puerto: ${PORT}`);
        console.log(`📡 Estado: Esperando clientes...`);
        console.log(`========================================`);
    });
    
    // Cargar datos iniciales para tenerlos listos
    const testLocations = await getCurrentLocations();
    if (testLocations.length > 0) {
        console.log(`✅ Datos precargados: ${testLocations.length} empleados`);
        lastEmittedData = testLocations;
    }
}

// ============================================
// MANEJO DE CIERRE GRACEFUL
// ============================================

process.on('SIGINT', () => {
    console.log('\n🛑 Cerrando servidor...');
    stopMonitoring();
    server.close(() => {
        console.log('👋 Servidor cerrado');
        process.exit(0);
    });
});

startServer().catch(error => {
    console.error('❌ Error fatal:', error);
    process.exit(1);
});
