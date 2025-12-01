const LiekoDB = require('../liekodb');

const db = new LiekoDB({
    storagePath: './chat_data',
    debug: true
});

const messages = db.collection('messages');
const users = db.collection('users');

(async () => {
    // Create users
    const createUsers = await users.insert([
        { id: 'u1', name: 'Alice', online: true, lastSeen: new Date().toISOString() },
        { id: 'u2', name: 'Bob', online: false, lastSeen: '2025-11-29T10:00:00Z' },
        { id: 'u3', name: 'Charlie', online: true }
    ]);
    console.log(createUsers)

    await messages.insert([
        { from: 'u1', to: 'u2', text: 'Hi Bob!', read: false, sentAt: new Date().toISOString() },
        { from: 'u2', to: 'u1', text: 'Hey Alice! How are you?', read: true, sentAt: new Date(Date.now() - 3600000).toISOString() },
        { from: 'u1', to: 'u3', text: 'Are you coming tonight?', read: false, sentAt: new Date().toISOString() },
        { from: 'u3', to: 'u1', text: 'Yes!', read: true, sentAt: new Date().toISOString() },
        { from: 'u2', to: 'u1', text: 'Please reply', read: false, sentAt: new Date(Date.now() - 3600000).toISOString() },
    ]);

    // Get unread conversations for Alice
    const unread = await messages.find({
        to: 'u1',
        read: false
    }, {
        fields: { from: 1, text: 1, sentAt: 1 },
        sort: { sentAt: -1 }
    });

    console.log('Unread messages for Alice:', unread);

    // Mark as read
    await messages.update(
        { to: 'u1', read: false },
        { $set: { read: true, readAt: new Date().toISOString() } }
    );

    const messagesFromBob = await messages.count({ from: 'u2', to: 'u1' });
    //const messagesFromBob = await db.collection('messages').count({ from: 'u2', to: 'u1' }); // Same as above
    console.log('Messages from Bob to Alice:', messagesFromBob);

    // Stats: who is online?
    const onlineUsers = await users.find({ online: true }, { fields: { name: 1 } });
    console.log('Online ->', onlineUsers.map(u => u.name).join(', '));

    //await db.close(); // optional, to close the database connection
})();