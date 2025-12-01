const LiekoDB = require('../liekodb');

const db = new LiekoDB({ 
    storagePath: './blog_data', 
    debug: true 
});

const posts = db.collection('posts');
const comments = db.collection('comments');


(async () => {

    // Create a post
    const post = await posts.insert({
        title: 'Introduction to LiekoDB',
        content: 'LiekoDB is a database...',
        author: 'Alice',
        tags: ['database', 'nodejs'],
        views: 0,
        published: true
    });
    console.log(post)

    // Increment views
    await posts.updateById(post.insertedId, {
        $inc: { views: 1 }
    });

    // Add a comment
    await comments.insert({
        postId: post.insertedId,
        author: 'Bob',
        text: 'Very interesting article!',
        likes: 0
    });

    // Find all published posts with 'nodejs' tag
    const nodejsPosts = await posts.find({
        published: true,
        tags: 'nodejs'
    }, {
        sort: { views: -1 },
        limit: 10
    });

    console.log(nodejsPosts)

    //await db.close(); // optional, to close the database connection
})();