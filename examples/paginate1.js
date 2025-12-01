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

    // 2. Pagination configuration
    const PAGE_SIZE = 10;
    let currentPage = 1;

    // Helper function to display a page
    const displayPage = async (page, filters = {}, sortOptions = {}) => {
        const skip = (page - 1) * PAGE_SIZE;
        
        // Count total to calculate number of pages
        const totalItems = await products.count(filters);
        const totalPages = Math.ceil(totalItems / PAGE_SIZE);
        
        // Get page items
        const items = await products.find(filters, {
            sort: sortOptions,
            skip: skip,
            limit: PAGE_SIZE
        });
        
        console.log(`\n${'='.repeat(80)}`);
        console.log(`📄 PAGE ${page}/${totalPages} (${totalItems} items total)`);
        console.log(`${'='.repeat(80)}`);
        
        if (items.length === 0) {
            console.log('   No results found.');
        } else {
            items.forEach((item, index) => {
                const itemNumber = skip + index + 1;
                console.log(`   ${itemNumber}. ${item.name.padEnd(15)} | ${item.category.padEnd(12)} | $${item.price.toString().padStart(4)} | Stock: ${item.stock.toString().padStart(3)} | ⭐ ${item.rating}`);
            });
        }
        
        return { totalPages, currentPage: page };
    };

    // 3. EXAMPLE 1: Simple pagination (all products)
    console.log('\n\n🔹 EXAMPLE 1: Pagination of all products\n');
    
    await displayPage(1);
    await displayPage(2);
    await displayPage(3);

    // 4. EXAMPLE 2: Pagination with filters
    console.log('\n\n🔹 EXAMPLE 2: Pagination with filter (Electronics category)\n');
    
    const electronicsFilter = { category: 'Electronics' };
    await displayPage(1, electronicsFilter);
    await displayPage(2, electronicsFilter);

    // 5. EXAMPLE 3: Pagination with sorting
    console.log('\n\n🔹 EXAMPLE 3: Pagination with sorting (price descending)\n');
    
    await displayPage(1, {}, { price: -1 });
    await displayPage(2, {}, { price: -1 });

    // 6. EXAMPLE 4: Pagination with filters AND sorting
    console.log('\n\n🔹 EXAMPLE 4: Pagination with filter AND sorting (Electronics, price desc)\n');
    
    await displayPage(1, electronicsFilter, { price: -1 });

    // 7. EXAMPLE 5: Interactive navigation (simulation)
    console.log('\n\n🔹 EXAMPLE 5: Interactive navigation simulation\n');
    
    const expensiveFilter = { price: { $gte: 500 } };
    
    console.log('Expensive products (≥ $500):\n');
    let pageInfo = await displayPage(1, expensiveFilter, { price: -1 });
    
    // Simulate "next page"
    if (pageInfo.currentPage < pageInfo.totalPages) {
        console.log('\n>>> Click on "Next Page" <<<');
        pageInfo = await displayPage(2, expensiveFilter, { price: -1 });
    }
    
    // Simulate "previous page"
    if (pageInfo.currentPage > 1) {
        console.log('\n>>> Click on "Previous Page" <<<');
        pageInfo = await displayPage(1, expensiveFilter, { price: -1 });
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
            this.currentPage = 1; // Reset to page 1 when filters change
            return this;
        }

        setSort(sort) {
            this.sort = sort;
            return this;
        }

        async getPage(page) {
            const skip = (page - 1) * this.pageSize;
            const totalItems = await this.collection.count(this.filters);
            const totalPages = Math.ceil(totalItems / this.pageSize);

            const items = await this.collection.find(this.filters, {
                sort: this.sort,
                skip: skip,
                limit: this.pageSize
            });

            return {
                items,
                pagination: {
                    currentPage: page,
                    pageSize: this.pageSize,
                    totalItems,
                    totalPages,
                    hasNext: page < totalPages,
                    hasPrev: page > 1
                }
            };
        }

        async next() {
            this.currentPage++;
            return this.getPage(this.currentPage);
        }

        async prev() {
            if (this.currentPage > 1) {
                this.currentPage--;
            }
            return this.getPage(this.currentPage);
        }

        async first() {
            this.currentPage = 1;
            return this.getPage(1);
        }

        async last() {
            const totalItems = await this.collection.count(this.filters);
            const totalPages = Math.ceil(totalItems / this.pageSize);
            this.currentPage = totalPages;
            return this.getPage(totalPages);
        }
    }

    // Using the Paginator
    const paginator = new Paginator(products, 5);
    paginator.setFilters({ category: 'Books' }).setSort({ price: 1 });

    let result = await paginator.getPage(1);
    console.log(`\nBooks - Page ${result.pagination.currentPage}/${result.pagination.totalPages}:`);
    result.items.forEach(item => {
        console.log(`   - ${item.name} | $${item.price}`);
    });

    if (result.pagination.hasNext) {
        result = await paginator.next();
        console.log(`\nBooks - Page ${result.pagination.currentPage}/${result.pagination.totalPages}:`);
        result.items.forEach(item => {
            console.log(`   - ${item.name} | $${item.price}`);
        });
    }

    // 9. EXAMPLE 7: Pagination with complete metadata (for REST API)
    console.log('\n\n🔹 EXAMPLE 7: REST API format with complete metadata\n');
    
    const buildApiResponse = async (page, filters = {}, sort = {}, pageSize = 10) => {
        const skip = (page - 1) * pageSize;
        const totalItems = await products.count(filters);
        const totalPages = Math.ceil(totalItems / pageSize);
        
        const items = await products.find(filters, {
            sort,
            skip,
            limit: pageSize
        });
        
        return {
            success: true,
            data: items,
            pagination: {
                page,
                pageSize,
                totalItems,
                totalPages,
                hasNextPage: page < totalPages,
                hasPreviousPage: page > 1,
                nextPage: page < totalPages ? page + 1 : null,
                previousPage: page > 1 ? page - 1 : null,
                startIndex: skip + 1,
                endIndex: Math.min(skip + pageSize, totalItems)
            }
        };
    };

    const apiResponse = await buildApiResponse(2, { category: 'Toys' }, { price: -1 }, 5);
    console.log(JSON.stringify(apiResponse, null, 2));

    await db.close();
})();