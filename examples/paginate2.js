const LiekoDB = require('../liekodb');

const db = new LiekoDB({
    storagePath: './pagination_demo',
    debug: false
});

const products = db.collection('products');

(async () => {
    console.log('=== PAGINATION DEMO ===\n');

    // 1. Insert test data (50 products)
    console.log('📦 Inserting 50 products...\n');
    
    const productData = [];
    const categories = ['Electronics', 'Clothing', 'Books', 'Food', 'Toys'];
    
    for (let i = 1; i <= 50; i++) {
        productData.push({
            name: `Product ${i}`,
            price: Math.floor(Math.random() * 1000) + 10,
            category: categories[i % categories.length],
            stock: Math.floor(Math.random() * 100),
            rating: (Math.random() * 5).toFixed(1)
        });
    }
    
    await products.insert(productData);

    // Helper function to display a page
    const displayPage = (result) => {
        const { data, pagination } = result;
        
        console.log(`\n${'='.repeat(80)}`);
        console.log(`📄 PAGE ${pagination.page}/${pagination.totalPages} (${pagination.totalItems} items total)`);
        console.log(`${'='.repeat(80)}`);
        
        if (data.length === 0) {
            console.log('   No results found.');
        } else {
            data.forEach((item, index) => {
                const itemNumber = pagination.startIndex + index;
                console.log(`   ${itemNumber}. ${item.name.padEnd(15)} | ${item.category.padEnd(12)} | $${item.price.toString().padStart(4)} | Stock: ${item.stock.toString().padStart(3)} | ⭐ ${item.rating}`);
            });
        }
        
        return pagination;
    };

    // 3. EXAMPLE 1: Simple pagination (all products)
    console.log('\n\n🔹 EXAMPLE 1: Pagination of all products\n');
    
    let result = await products.paginate({}, { page: 1, limit: 10 });
    displayPage(result);
    
    result = await products.paginate({}, { page: 2, limit: 10 });
    displayPage(result);
    
    result = await products.paginate({}, { page: 3, limit: 10 });
    displayPage(result);

    // 4. EXAMPLE 2: Pagination with filters
    console.log('\n\n🔹 EXAMPLE 2: Pagination with filter (Electronics category)\n');
    
    const electronicsFilter = { category: 'Electronics' };
    result = await products.paginate(electronicsFilter, { page: 1, limit: 10 });
    displayPage(result);
    
    result = await products.paginate(electronicsFilter, { page: 2, limit: 10 });
    displayPage(result);

    // 5. EXAMPLE 3: Pagination with price sorting
    console.log('\n\n🔹 EXAMPLE 3: Pagination with sorting (price descending)\n');
    
    result = await products.paginate({}, { page: 1, limit: 10, sort: { price: -1 } });
    displayPage(result);

    result = await products.paginate({}, { page: 2, limit: 10, sort: { price: -1 } });
    displayPage(result);

    // 6. EXAMPLE 4: Pagination with filters AND price sorting
    console.log('\n\n🔹 EXAMPLE 4: Pagination with filter AND sorting (Electronics, price desc)\n');
    
    result = await products.paginate(electronicsFilter, { page: 1, limit: 10, sort: { price: -1 } });
    displayPage(result);

    // 7. EXAMPLE 5: Interactive navigation (simulation)
    console.log('\n\n🔹 EXAMPLE 5: Interactive navigation simulation\n');
    
    const expensiveFilter = { price: { $gte: 500 } };
    
    console.log('Expensive products (≥ $500):\n');
    result = await products.paginate(expensiveFilter, { page: 1, limit: 10, sort: { price: -1 } });
    let pageInfo = displayPage(result);
    
    // Simulate "next page"
    if (pageInfo.hasNext) {
        console.log('\n>>> Click on "Next Page" <<<');
        result = await products.paginate(expensiveFilter, { page: pageInfo.nextPage, limit: 10, sort: { price: -1 } });
        pageInfo = displayPage(result);
    }
    
    // Simulate "previous page"
    if (pageInfo.hasPrev) {
        console.log('\n>>> Click on "Previous Page" <<<');
        result = await products.paginate(expensiveFilter, { page: pageInfo.prevPage, limit: 10, sort: { price: -1 } });
        pageInfo = displayPage(result);
    }

    // 8. EXAMPLE 6: Reusable PaginationHelper class
    console.log('\n\n🔹 EXAMPLE 6: Using a PaginationHelper class\n');
    
    class Paginator {
        constructor(collection, pageSize = 10) {
            this.collection = collection;
            this.pageSize = pageSize;
            this.currentPage = 1;
            this.filters = {};
            this.sort = {};
        }

        setFilters(filters) {
            this.filters = filters;
            this.currentPage = 1;
            return this;
        }

        setSort(sort) {
            this.sort = sort;
            return this;
        }

        async getPage(page) {
            this.currentPage = page;
            return this.collection.paginate(this.filters, {
                page,
                limit: this.pageSize,
                sort: this.sort
            });
        }

        async next() {
            const result = await this.getPage(this.currentPage);
            if (result.pagination.hasNext) {
                return this.getPage(result.pagination.nextPage);
            }
            return result;
        }

        async prev() {
            const result = await this.getPage(this.currentPage);
            if (result.pagination.hasPrev) {
                return this.getPage(result.pagination.prevPage);
            }
            return result;
        }

        async first() {
            return this.getPage(1);
        }

        async last() {
            const result = await this.getPage(1);
            return this.getPage(result.pagination.totalPages);
        }
    }

    // Using the Paginator
    const paginator = new Paginator(products, 5);
    paginator.setFilters({ category: 'Books' }).setSort({ price: 1 });

    result = await paginator.getPage(1);
    console.log(`\nBooks - Page ${result.pagination.page}/${result.pagination.totalPages}:`);
    result.data.forEach(item => {
        console.log(`   - ${item.name} | $${item.price}`);
    });

    if (result.pagination.hasNext) {
        result = await paginator.next();
        console.log(`\nBooks - Page ${result.pagination.page}/${result.pagination.totalPages}:`);
        result.data.forEach(item => {
            console.log(`   - ${item.name} | $${item.price}`);
        });
    }

    // 9. EXAMPLE 7: Pagination with complete metadata (for REST API)
    console.log('\n\n🔹 EXAMPLE 7: REST API format with complete metadata\n');
    
    const apiResponse = await products.paginate(
        { category: 'Toys' },
        { page: 2, limit: 5, sort: { price: -1 } }
    );
    
    console.log(JSON.stringify({
        success: true,
        ...apiResponse
    }, null, 2));

    // 10. EXAMPLE 8: Edge cases
    console.log('\n\n🔹 EXAMPLE 8: Edge cases\n');
    
    // Empty results
    result = await products.paginate({ category: 'NonExistent' }, { page: 1, limit: 10 });
    console.log(`Empty results - Total items: ${result.pagination.totalItems}`);
    console.log(`Has next: ${result.pagination.hasNext}, Has prev: ${result.pagination.hasPrev}`);
    
    // Page beyond last page
    result = await products.paginate({}, { page: 999, limit: 10 });
    console.log(`\nPage 999 (beyond last page):`);
    console.log(`Items returned: ${result.data.length}`);
    console.log(`Total pages: ${result.pagination.totalPages}`);
    console.log(`Has next: ${result.pagination.hasNext}, Has prev: ${result.pagination.hasPrev}`);

    await db.close();
})();