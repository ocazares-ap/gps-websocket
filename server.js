const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mysql = require('mysql2/promise');
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

// ⚠️ IMPORTANTE: Cambia 'localhost' por la IP de tu HostGator
// Para obtener la IP: Ve a cPanel > Información del servidor
const dbConfig = {
    host: '162.240.103.95',  // ← CAMBIA ESTO por la IP de HostGator
    user: 'wwtene_dev',
    password: ',.-3A601b14a0-.,',
    database: 'wwtene_tenet',
    waitForConnections: true,
    connectionLimit: 10
};

let pool;
let lastCheckTime = null;
let checkInterval = null;

async function initDB() {
    try {
        pool = mysql.createPool(dbConfig);
        console.log('✅ Conectado a MySQL');
        const conn = await pool.getConnection();
        try {
            const [rows] = await conn.query(`SELECT MAX(updated_at) as last_update FROM ubicacion`);
            lastCheckTime = rows[0].last_update || new Date();
            console.log(`📅 Última actualización: ${lastCheckTime}`);
        } finally {
            conn.release();
        }
    } catch (error) {
        console.error('❌ Error conectando a MySQL:', error);
        setTimeout(initDB, 5000);
    }
}

async function getCurrentLocations() {
    const conn = await pool.getConnection();
    try {
        const [rows] = await conn.query(`
            SELECT 
                u.empleado_identificador as id,
                COALESCE(e.nombre, u.empleado_identificador) as nombre,
                u.latitude as lat,
                u.longitude as lng,
                u.updated_at as ultima_actualizacion,
                TIMESTAMPDIFF(MINUTE, u.updated_at, NOW()) as minutos_inactivo
            FROM ubicacion u
            LEFT JOIN empleados e ON u.empleado_identificador = e.identificador
            INNER JOIN (
                SELECT empleado_identificador, MAX(updated_at) as max_updated
                FROM ubicacion
                GROUP BY empleado_identificador
            ) latest ON u.empleado_identificador = latest.empleado_identificador 
                    AND u.updated_at = latest.max_updated
            ORDER BY u.updated_at DESC
        `);

        return rows.map(row => {
            let estado, color, pulso;
            if (row.minutos_inactivo <= 5) {
                estado = 'activo';
                color = '#10B981';
                pulso = true;
            } else if (row.minutos_inactivo <= 30) {
                estado = 'pendiente';
                color = '#F59E0B';
                pulso = false;
            } else {
                estado = 'inactivo';
                color = '#6B7280';
                pulso = false;
            }

            return {
                ...row,
                lat: parseFloat(row.lat),
                lng: parseFloat(row.lng),
                minutos_inactivo: parseInt(row.minutos_inactivo),
                estado,
                color,
                pulso,
                ultima_actualizacion: row.ultima_actualizacion
            };
        });
    } finally {
        conn.release();
    }
}

async function checkForUpdates() {
    try {
        if (!pool) return;
        const conn = await pool.getConnection();
        try {
            const [newLocations] = await conn.query(
                `SELECT 1 FROM ubicacion WHERE updated_at > ? LIMIT 1`,
                [lastCheckTime]
            );

            if (newLocations.length > 0) {
                console.log('📡 Detectadas nuevas ubicaciones');
                lastCheckTime = new Date();
                const allLocations = await getCurrentLocations();
                if (allLocations.length > 0) {
                    io.emit('locations_update', allLocations);
                    console.log(`📤 Emitidas ${allLocations.length} ubicaciones`);
                }
            }
        } finally {
            conn.release();
        }
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

app.get('/api/ubicaciones', async (req, res) => {
    try {
        const locations = await getCurrentLocations();
        res.json({ success: true, empleados: locations, total: locations.length });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error al obtener ubicaciones' });
    }
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        clients_connected: io.engine.clientsCount || 0,
        last_check: lastCheckTime
    });
});

io.on('connection', (socket) => {
    console.log(`👤 Cliente conectado: ${socket.id}`);
    (async () => {
        try {
            const locations = await getCurrentLocations();
            socket.emit('initial_locations', locations);
        } catch (error) {
            socket.emit('error', { message: 'Error al cargar datos iniciales' });
        }
    })();
});

async function startServer() {
    await initDB();
    if (pool) {
        checkInterval = setInterval(checkForUpdates, 3000);
        console.log('🔄 Monitoreo iniciado (intervalo: 3s)');
    }
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`🚀 Servidor en puerto ${PORT}`);
    });
}

startServer().catch(console.error);