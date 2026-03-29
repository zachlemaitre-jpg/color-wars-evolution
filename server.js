const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static(__dirname));

let rooms = {};

io.on('connection', (socket) => {
    console.log('🟢 Connexion:', socket.id);

    socket.on('joinRoom', (roomCode) => {
        socket.join(roomCode);
        
        // Initialisation de la salle si elle n'existe pas
        if (!rooms[roomCode]) {
            rooms[roomCode] = {
                clients: [], 
                settings: { playerCount: 3, gridSize: 'normal', biome: 'classic', toggles: {} }, 
                grid: null,
                isPlaying: false
            };
        }
        
        const room = rooms[roomCode];
        if (!room.clients.includes(socket.id)) room.clients.push(socket.id);

        // Le premier arrivé est l'Hôte
        const isHost = room.clients[0] === socket.id;
        
        socket.emit('lobbyJoined', {
            roomCode: roomCode,
            isHost: isHost,
            settings: room.settings
        });
    });

    // Création de salon sécurisée côté serveur
    socket.on('createRoom', () => {
        let newRoomCode;
        
        // CORRECTION : On vérifie l'unicité directement dans notre objet 'rooms'
        while (rooms[newRoomCode = Math.random().toString(36).substring(2, 8).toUpperCase()]);

        rooms[newRoomCode] = {
            clients: [socket.id],
            settings: { playerCount: 3, gridSize: 'normal', biome: 'classic', toggles: {} },
            grid: null,
            isPlaying: false
        };

        socket.join(newRoomCode);
        socket.emit('lobbyJoined', {
            roomCode: newRoomCode,
            isHost: true,
            settings: rooms[newRoomCode].settings
        });
    });

    // 🔄 Synchronisation du Salon (Seul l'hôte a le droit)
    socket.on('updateSettings', (data) => {
        const room = rooms[data.roomCode];
        if (room && room.clients[0] === socket.id) {
            room.settings = data.settings;
            // Diffuse les réglages à tous les autres clients du salon
            socket.to(data.roomCode).emit('settingsChanged', room.settings);
        }
    });

    // 🚀 Lancement de la partie
    socket.on('requestStartGame', (data) => {
        const room = rooms[data.roomCode];
        if (room && room.clients[0] === socket.id) {
            room.isPlaying = true;
            
            // Distribution des Rôles
            room.clients.forEach((clientId, index) => {
                let role = 'spectator';
                if (index < room.settings.playerCount) {
                    role = index + 1; // Joueur 1 à 6
                }
                io.to(clientId).emit('gameStarted', { playerNum: role, settings: room.settings });
            });
        }
    });

    // Mécaniques de jeu (inchangées)
    socket.on('saveMap', (data) => {
        if(rooms[data.room]) {
            rooms[data.room].grid = data.grid;
            socket.to(data.room).emit('loadMap', data.grid);
        }
    });

    socket.on('playTurn', (data) => {
        io.to(data.room).emit('updateBoard', data);
    });

    // 🔙 Retour au salon post-partie
    socket.on('requestReturnToLobby', (roomCode) => {
        const room = rooms[roomCode];
        if (room && room.clients[0] === socket.id) {
            room.isPlaying = false;
            io.to(roomCode).emit('returnToLobby');
        }
    });

    socket.on('disconnect', () => {
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const index = room.clients.indexOf(socket.id);
            if (index !== -1) {
                room.clients.splice(index, 1);
                if (room.clients.length === 0) {
                    delete rooms[roomCode]; // Détruit la salle si vide
                } else if (index === 0) {
                    // Si l'Hôte part, le Joueur 2 devient l'Hôte
                    io.to(room.clients[0]).emit('hostMigrated');
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`🚀 Serveur activé sur le port ${PORT}`);
});