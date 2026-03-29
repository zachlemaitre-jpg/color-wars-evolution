const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static(__dirname));

let rooms = {};

io.on('connection', (socket) => {
    console.log('🟢 Connexion:', socket.id);

    socket.on('joinRoom', (data) => {
        // Rétrocompatibilité au cas où (si data est une simple string)
        let roomCode = typeof data === 'string' ? data : data.roomCode;
        let pseudo = typeof data === 'string' ? 'Invité' : data.pseudo;

        socket.join(roomCode);
        
        if (!rooms[roomCode]) {
            rooms[roomCode] = {
                clients: [], 
                settings: { playerCount: 3, gridSize: 'normal', biome: 'classic', toggles: {} }, 
                grid: null,
                isPlaying: false
            };
        }
        
        const room = rooms[roomCode];
        // On vérifie si l'id n'est pas déjà dans la liste (reconnexion)
        if (!room.clients.find(c => c.id === socket.id)) {
            room.clients.push({ id: socket.id, pseudo: pseudo });
        }

        const isHost = room.clients[0].id === socket.id;
        
        socket.emit('lobbyJoined', {
            roomCode: roomCode,
            isHost: isHost,
            settings: room.settings
        });

        // 📡 DIFFUSION : Nouveau joueur dans la salle
        io.to(roomCode).emit('playersUpdated', room.clients);
    });

    socket.on('createRoom', (data) => {
        let newRoomCode;
        let pseudo = data && data.pseudo ? data.pseudo : 'Hôte';
        
        while (rooms[newRoomCode = Math.random().toString(36).substring(2, 8).toUpperCase()]);

        rooms[newRoomCode] = {
            clients: [{ id: socket.id, pseudo: pseudo }],
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

        io.to(newRoomCode).emit('playersUpdated', rooms[newRoomCode].clients);
    });

    socket.on('updateSettings', (data) => {
        const room = rooms[data.roomCode];
        if (room && room.clients[0].id === socket.id) { // VÉRIF MIGRÉE (OBJET)
            room.settings = data.settings;
            socket.to(data.roomCode).emit('settingsChanged', room.settings);
            
            // On renvoie la liste des joueurs car le changement de playerCount 
            // modifie le statut "Joueur/Spectateur" dans l'UI du lobby
            io.to(data.roomCode).emit('playersUpdated', room.clients);
        }
    });

    socket.on('requestStartGame', (data) => {
        const room = rooms[data.roomCode];
        if (room && room.clients[0].id === socket.id) { // VÉRIF MIGRÉE
            room.isPlaying = true;
            
            room.clients.forEach((client, index) => {
                let role = 'spectator';
                if (index < room.settings.playerCount) {
                    role = index + 1; 
                }
                io.to(client.id).emit('gameStarted', { playerNum: role, settings: room.settings });
            });
        }
    });

    socket.on('saveMap', (data) => {
        if(rooms[data.room]) {
            rooms[data.room].grid = data.grid;
            socket.to(data.room).emit('loadMap', data.grid);
        }
    });

    socket.on('playTurn', (data) => {
        io.to(data.room).emit('updateBoard', data);
    });
    
    socket.on('sendChat', (data) => {
        io.to(data.room).emit('chatMessage', {
            sender: data.sender,
            text: data.text,
            pseudo: data.pseudo // Vient d'être ajouté côté client
        });
    });

    socket.on('requestReturnToLobby', (roomCode) => {
        const room = rooms[roomCode];
        if (room && room.clients[0].id === socket.id) { // VÉRIF MIGRÉE
            room.isPlaying = false;
            io.to(roomCode).emit('returnToLobby');
        }
    });

    socket.on('disconnect', () => {
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            // Recherche de l'index via la propriété id
            const index = room.clients.findIndex(c => c.id === socket.id); 
            if (index !== -1) {
                room.clients.splice(index, 1);
                if (room.clients.length === 0) {
                    delete rooms[roomCode]; 
                } else {
                    if (index === 0) {
                        io.to(room.clients[0].id).emit('hostMigrated');
                    }
                    // 📡 DIFFUSION : Un joueur a quitté
                    io.to(roomCode).emit('playersUpdated', room.clients);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`🚀 Serveur activé sur le port ${PORT}`);
});