const LiekoDB = require('../liekodb');

const db = new LiekoDB({ 
    storagePath: './shop_data', 
    debug: true 
});

const products = db.collection('products');
const orders = db.collection('orders');

((async () => {

    // Add products
    await products.insert([
        { name: 'Laptop', price: 999, stock: 10, category: 'electronics' },
        { name: 'Mouse', price: 25, stock: 100, category: 'accessories' },
        { name: 'Keyboard', price: 75, stock: 50, category: 'accessories' }
    ]);

    // Create an order
    const order = await orders.insert({
        customerId: 'user_123',
        items: [
            { productId: 'prod_1', quantity: 1, price: 999 },
            { productId: 'prod_2', quantity: 2, price: 25 }
        ],
        total: 1049,
        status: 'pending'
    });

    console.log(order)

    // Update stock
    await products.update(
        { name: 'Laptop' },
        { $inc: { stock: -1 } }
    );

    // Find out of stock products
    const outOfStock = await products.find({
        stock: { $lte: 5 }
    });
    console.log('Out of stock products:', outOfStock);

    // Statistics
    const totalOrders = await orders.count();
    console.log('Total orders:', totalOrders);

    const pendingOrders = await orders.count({ status: 'pending' });
    console.log('Pending orders:', pendingOrders);
    
    // Mark order as shipped
    await orders.updateById(order.insertedId, {
        $set: { status: 'shipped', shippedAt: new Date().toISOString() }
    });

    // await db.close(); // optional, to close the database connection
})());