const LiekoDB = require('../liekodb');

const db = new LiekoDB({
    storagePath: './todos',
    debug: true
});

const todos = db.collection('todos');

(async () => {

    await todos.insert([
        { text: 'Finish LiekoDB', done: true, priority: 'high', tags: ['dev', 'open-source'], due: '2025-12-01' },
        { text: 'Go grocery shopping', done: false, priority: 'medium', tags: ['personal'], due: '2025-11-30' },
        { text: 'Exercise', done: false, priority: 'low', tags: ['health'], due: '2025-12-05' }
    ]);

    const urgent = await todos.find({
        done: false,
        due: { $lte: new Date().toISOString().split('T')[0] }
    }, { sort: { priority: -1 } });

    const devTasks = await todos.find({ tags: 'dev' });

    await todos.update(
        { text: 'Go grocery shopping' },
        { $set: { done: true, completedAt: new Date().toISOString() } }
    );

    console.log('Urgent tasks:', urgent);
    console.log('Dev tasks:', devTasks);

    await db.close();
})();