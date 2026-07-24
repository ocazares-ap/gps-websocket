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

// ============================================
// CONFIGURACIÓN - USA TU API PHP EN HOSTGATOR
// ============================================
const API_URL = 'https://swtenet.com/live/api_ultimas_ubicaciones.php';

// Variable para almacenar la última respuesta (evita emitir datos duplicados)
let lastEmittedData = null;

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
            console.warn('⚠️ API no devolvió empleados:', data);
            return [];
        }
    } catch (error) {
        console.error('❌ Error consultando API:', error.message);
        return [];
    }
}

// ============================================
// FUNCIÓN: Verificar cambios y emitir si hay nuevos datos
// ============================================
async function checkAndEmitUpdates() {
    try {
        const locations = await getCurrentLocations();
        
        if (locations.length === 0) {
            return;
        }
        
        // Convertir a string para comparar si hubo cambios
        const currentDataStr = JSON.stringify(locations);
        const lastDataStr = lastEmittedData ? JSON.stringify(lastEmittedData) : null;
        
        // Solo emitir si los datos cambiaron
        if (currentDataStr !== lastDataStr) {
            lastEmittedData = locations;
            io.emit('locations_update', locations);
            console.log(`📤 Emitidas ${locations.length} ubicaciones a ${io.engine.clientsCount} clientes`);
        }
    } catch (error) {
        console.error('❌ Error en checkAndEmitUpdates:', error.message);
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
        console.error('❌ Error en /api/ubicaciones:', error.message);
        res.status(500).json({
            success: false,
            error: 'Error al obtener ubicaciones'
        });
    }
});

// Endpoint de salud para verificar estado
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        clients_connected: io.engine.clientsCount || 0,
        api_url: API_URL,
        last_emitted: lastEmittedData ? `${lastEmittedData.length} empleados` : 'ninguno'
    });
});

// Endpoint para recibir ubicaciones desde Android (opcional, si quieres mantenerlo)
app.post('/api/ubicacion', async (req, res) => {
    try {
        const { identificador, latitude, longitude } = req.body;
        
        if (!identificador || !latitude || !longitude) {
            return res.status(400).json({
                success: false,
                error: 'Faltan parámetros: identificador, latitude, longitude'
            });
        }
        
        // Aquí podrías guardar en tu base de datos si lo deseas
        // O simplemente responder que se recibió
        console.log(`📱 Ubicación recibida de ${identificador}: ${latitude}, ${longitude}`);
        
        // Opcional: Podrías forzar una actualización inmediata
        // setTimeout(checkAndEmitUpdates, 500);
        
        res.json({
            success: true,
            message: 'Ubicación recibida correctamente'
        });
    } catch (error) {
        console.error('❌ Error en /api/ubicacion:', error.message);
        res.status(500).json({
            success: false,
            error: 'Error al procesar ubicación'
        });
    }
});

// ============================================
// SOCKET.IO - CONEXIONES DE CLIENTES
// ============================================

io.on('connection', (socket) => {
    console.log(`👤 Cliente conectado: ${socket.id} (Total: ${io.engine.clientsCount})`);
    
    // Enviar datos iniciales al cliente recién conectado
    (async () => {
        try {
            const locations = await getCurrentLocations();
            socket.emit('initial_locations', locations);
            console.log(`📤 Enviados ${locations.length} empleados a ${socket.id}`);
            
            // Guardar como último emitido para referencia
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

    // Escuchar eventos personalizados del cliente
    socket.on('request_update', async () => {
        try {
            const locations = await getCurrentLocations();
            socket.emit('locations_update', locations);
            console.log(`📤 Actualización solicitada enviada a ${socket.id}`);
        } catch (error) {
            console.error('❌ Error en request_update:', error.message);
        }
    });

    socket.on('disconnect', () => {
        console.log(`👤 Cliente desconectado: ${socket.id} (Total: ${io.engine.clientsCount})`);
    });
});

// ============================================
// MONITOREO PERIÓDICO (cada 3 segundos)
// ============================================

let updateInterval = null;

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
        console.log('⏹️ Monitoreo detenido');
    }
}

// ============================================
// INICIAR SERVIDOR
// ============================================

async function startServer() {
    // Probar conexión a la API al iniciar
    console.log('🔍 Probando conexión a la API...');
    const testLocations = await getCurrentLocations();
    if (testLocations.length > 0) {
        console.log(`✅ API funcionando: ${testLocations.length} empleados encontrados`);
        lastEmittedData = testLocations;
    } else {
        console.warn('⚠️ No se encontraron empleados en la API. Verifica que api_ultimas_ubicaciones.php esté funcionando.');
    }
    
    // Iniciar monitoreo periódico
    startMonitoring();
    
    // Iniciar servidor
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`========================================`);
        console.log(`🚀 Servidor WebSocket corriendo`);
        console.log(`📡 URL: https://gps-ws.onrender.com`);
        console.log(`📡 API: ${API_URL}`);
        console.log(`📡 Health Check: /api/health`);
        console.log(`📡 Puerto: ${PORT}`);
        console.log(`========================================`);
    });
}

// ============================================
// MANEJO DE CIERRE GRACEFUL
// ============================================

process.on('SIGINT', () => {
    console.log('\n🛑 Recibida señal SIGINT. Cerrando servidor...');
    stopMonitoring();
    server.close(() => {
        console.log('👋 Servidor cerrado');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Recibida señal SIGTERM. Cerrando servidor...');
    stopMonitoring();
    server.close(() => {
        console.log('👋 Servidor cerrado');
        process.exit(0);
    });
});

// ============================================
// EJECUTAR
// ============================================

startServer().catch(error => {
    console.error('❌ Error fatal iniciando servidor:', error);
    process.exit(1);
});
