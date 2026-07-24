const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

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

// ⚠️ IMPORTANTE: Usa la URL de tu API PHP en HostGator
const API_URL = 'https://swtenet.com/live/api_ultimas_ubicaciones.php';

// Función para obtener ubicaciones desde tu API PHP
async function getCurrentLocations() {
    try {
        const response = await fetch(API_URL);
        const data = await response.json();
        
        if (data.success && data.empleados) {
            console.log(`📡 API devolvió ${data.empleados.length} empleados`);
            return data.empleados;
        }
        return [];
    } catch (error) {
        console.error('❌ Error consultando API:', error);
        return [];
    }
}

// Endpoint para obtener ubicaciones (para carga inicial)
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
        clients_connected: io.engine.clientsCount || 0,
        timestamp: new Date().toISOString()
    });
});

// Socket.io - Conexiones
io.on('connection', (socket) => {
    console.log(`👤 Cliente conectado: ${socket.id}`);
    
    // Enviar datos iniciales
    (async () => {
        try {
            const locations = await getCurrentLocations();
            socket.emit('initial_locations', locations);
            console.log(`📤 Enviados ${locations.length} empleados a ${socket.id}`);
        } catch (error) {
            console.error('❌ Error:', error);
            socket.emit('error', { message: 'Error al cargar datos' });
        }
    })();

    socket.on('disconnect', () => {
        console.log(`👤 Cliente desconectado: ${socket.id}`);
    });
});

// Actualización periódica (cada 3 segundos)
let updateInterval = null;

async function checkForUpdates() {
    try {
        const locations = await getCurrentLocations();
        if (locations.length > 0) {
            io.emit('locations_update', locations);
            console.log(`📤 Actualización enviada: ${locations.length} empleados`);
        }
    } catch (error) {
        console.error('❌ Error en actualización:', error);
    }
}

// Iniciar servidor
async function startServer() {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`🚀 Servidor en puerto ${PORT}`);
        console.log(`📡 WebSocket: wss://gps-ws.onrender.com`);
        
        // Iniciar actualizaciones periódicas
        updateInterval = setInterval(checkForUpdates, 3000);
        console.log('🔄 Actualizaciones automáticas cada 3s');
    });
}

// Cierre graceful
process.on('SIGINT', () => {
    if (updateInterval) clearInterval(updateInterval);
    server.close(() => process.exit(0));
});

startServer().catch(console.error);
