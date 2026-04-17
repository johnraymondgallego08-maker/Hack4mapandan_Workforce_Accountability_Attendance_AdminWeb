/**
 * Universal Table Sorting and Pagination Utility
 * Applies to any table with id and data attributes
 */

class TableManager {
    constructor(tableId, options = {}) {
        this.tableId = tableId;
        this.table = document.getElementById(tableId);
        
        if (!this.table) {
            console.warn(`[TABLE] Table with ID "${tableId}" not found`);
            return;
        }

        this.itemsPerPage = options.itemsPerPage || 10;
        this.currentPage = 1;
        this.totalRows = 0;
        this.sortColumn = 'none';
        this.sortDirection = 'asc';
        
        this.init();
    }

    init() {
        this.setupSortableHeaders();
        this.setupPagination();
        this.initializePagination();
        console.log(`[TABLE] Initialized table: ${this.tableId}`);
    }

    setupSortableHeaders() {
        const thead = this.table.querySelector('thead');
        if (!thead) return;

        const headers = thead.querySelectorAll('th');
        headers.forEach((header, index) => {
            // Check if header has onclick or data-sortable attribute
            if (header.getAttribute('onclick') || header.getAttribute('data-sortable') === 'true') {
                header.style.cursor = 'pointer';
                header.style.userSelect = 'none';
                header.style.backgroundColor = 'rgba(0,0,0,0.02)';
                header.title = 'Click to sort';
                
                // Add icon if not already present
                if (!header.querySelector('.sort-icon')) {
                    const icon = document.createElement('i');
                    icon.className = 'sort-icon';
                    icon.setAttribute('data-lucide', 'arrow-up-down');
                    icon.style.width = '14px';
                    icon.style.height = '14px';
                    icon.style.marginLeft = '0.5rem';
                    icon.style.opacity = '0.5';
                    icon.style.display = 'inline-block';
                    header.appendChild(icon);
                }

                // Add click handler if not already present
                if (!header.getAttribute('onclick')) {
                    header.addEventListener('click', () => this.sortTable(index, header));
                }
            }
        });

        // Reinitialize lucide icons
        if (typeof lucide !== 'undefined' && lucide.createIcons) {
            setTimeout(() => lucide.createIcons(), 100);
        }
    }

    sortTable(columnIndex, headerElement) {
        const headers = this.table.querySelectorAll('thead th');
        const columnKey = `data-sort-${columnIndex}`;
        
        // Reset other headers
        headers.forEach(h => {
            const icon = h.querySelector('.sort-icon');
            if (icon) {
                icon.style.opacity = '0.5';
                icon.setAttribute('data-lucide', 'arrow-up-down');
            }
        });

        // Toggle direction if same column, otherwise reset to ascending
        if (this.sortColumn === columnIndex) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortDirection = 'asc';
        }

        this.sortColumn = columnIndex;

        const tbody = this.table.querySelector('tbody');
        const rows = Array.from(tbody.querySelectorAll('tr'));

        rows.sort((a, b) => {
            let aVal, bVal;

            // Try data attribute first
            const aDataAttr = a.getAttribute(columnKey);
            const bDataAttr = b.getAttribute(columnKey);

            if (aDataAttr !== null && bDataAttr !== null) {
                aVal = isNaN(aDataAttr) ? aDataAttr.toLowerCase() : parseFloat(aDataAttr);
                bVal = isNaN(bDataAttr) ? bDataAttr.toLowerCase() : parseFloat(bDataAttr);
            } else {
                // Fall back to cell text content
                const aCell = a.cells[columnIndex];
                const bCell = b.cells[columnIndex];
                
                if (!aCell || !bCell) return 0;
                
                aVal = aCell.textContent.trim().toLowerCase();
                bVal = bCell.textContent.trim().toLowerCase();
                
                // Try to parse as number if possible
                if (!isNaN(aVal) && !isNaN(bVal)) {
                    aVal = parseFloat(aVal);
                    bVal = parseFloat(bVal);
                }
            }

            if (this.sortDirection === 'asc') {
                return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
            } else {
                return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
            }
        });

        // Reorder rows in tbody
        rows.forEach(row => tbody.appendChild(row));

        // Update sort icon
        if (headerElement) {
            const icon = headerElement.querySelector('.sort-icon');
            if (icon) {
                icon.setAttribute('data-lucide', this.sortDirection === 'asc' ? 'arrow-up' : 'arrow-down');
                icon.style.opacity = '1';
                if (typeof lucide !== 'undefined' && lucide.createIcons) {
                    setTimeout(() => lucide.createIcons(), 0);
                }
            }
        }

        // Reset to page 1 after sorting
        this.currentPage = 1;
        this.displayPage(1);
    }

    setupPagination() {
        const paginationId = `${this.tableId}-pagination`;
        let paginationControls = document.getElementById(paginationId);

        if (!paginationControls) {
            paginationControls = document.createElement('div');
            paginationControls.id = paginationId;
            paginationControls.style.cssText = `
                display: flex;
                justify-content: center;
                align-items: center;
                gap: 0.5rem;
                margin-top: 1.25rem;
                flex-wrap: wrap;
                border-top: 1px solid rgba(0,0,0,0.1);
                padding-top: 1rem;
            `;

            const prevBtn = document.createElement('button');
            prevBtn.id = `${this.tableId}-prev`;
            prevBtn.className = 'btn';
            prevBtn.style.cssText = 'padding: 0.4rem 0.8rem; font-size: 0.9rem;';
            prevBtn.innerHTML = '<i data-lucide="chevron-left" style="width:16px; height:16px; display:inline;"></i> Previous';
            prevBtn.onclick = () => this.previousPage();

            const pageInfo = document.createElement('span');
            pageInfo.id = `${this.tableId}-page-info`;
            pageInfo.style.cssText = 'margin: 0 0.5rem; font-size: 0.9rem; min-width: 120px; text-align: center;';
            pageInfo.textContent = 'Page 1 of 1';

            const nextBtn = document.createElement('button');
            nextBtn.id = `${this.tableId}-next`;
            nextBtn.className = 'btn';
            nextBtn.style.cssText = 'padding: 0.4rem 0.8rem; font-size: 0.9rem;';
            nextBtn.innerHTML = 'Next <i data-lucide="chevron-right" style="width:16px; height:16px; display:inline;"></i>';
            nextBtn.onclick = () => this.nextPage();

            paginationControls.appendChild(prevBtn);
            paginationControls.appendChild(pageInfo);
            paginationControls.appendChild(nextBtn);

            this.table.parentElement.insertBefore(paginationControls, this.table.nextSibling);
        }

        this.paginationControls = paginationControls;
    }

    initializePagination() {
        const tbody = this.table.querySelector('tbody');
        if (!tbody) return;

        const rows = tbody.querySelectorAll('tr');
        this.totalRows = rows.length;

        if (this.totalRows > this.itemsPerPage) {
            this.paginationControls.style.display = 'flex';
        } else {
            this.paginationControls.style.display = 'none';
        }

        this.displayPage(1);
    }

    displayPage(pageNum) {
        const tbody = this.table.querySelector('tbody');
        const rows = tbody.querySelectorAll('tr');
        const totalPages = Math.ceil(this.totalRows / this.itemsPerPage);

        if (pageNum < 1) pageNum = 1;
        if (pageNum > totalPages) pageNum = totalPages;

        this.currentPage = pageNum;

        // Hide all rows
        rows.forEach(row => row.style.display = 'none');

        // Show only rows for current page
        const startIdx = (pageNum - 1) * this.itemsPerPage;
        const endIdx = startIdx + this.itemsPerPage;

        for (let i = startIdx; i < endIdx && i < rows.length; i++) {
            rows[i].style.display = '';
        }

        // Update pagination info
        const pageInfo = document.getElementById(`${this.tableId}-page-info`);
        if (pageInfo) {
            pageInfo.textContent = `Page ${pageNum} of ${totalPages}`;
        }

        // Update button states
        const prevBtn = document.getElementById(`${this.tableId}-prev`);
        const nextBtn = document.getElementById(`${this.tableId}-next`);

        if (prevBtn) prevBtn.disabled = (pageNum === 1);
        if (nextBtn) nextBtn.disabled = (pageNum === totalPages);

        // Reinitialize lucide icons
        if (typeof lucide !== 'undefined' && lucide.createIcons) {
            setTimeout(() => lucide.createIcons(), 0);
        }
    }

    nextPage() {
        const totalPages = Math.ceil(this.totalRows / this.itemsPerPage);
        if (this.currentPage < totalPages) {
            this.displayPage(this.currentPage + 1);
        }
    }

    previousPage() {
        if (this.currentPage > 1) {
            this.displayPage(this.currentPage - 1);
        }
    }

    // Reinitialize when rows change (real-time updates)
    reinitialize() {
        setTimeout(() => {
            this.initializePagination();
            console.log(`[TABLE] Reinitialized: ${this.tableId}`);
        }, 100);
    }
}

// Global table manager instances
window.tableManagers = {};

// Initialize all tables on page load
document.addEventListener('DOMContentLoaded', () => {
    initializeAllTables();
});

function initializeAllTables() {
    // Find all tables with IDs that should have sorting/pagination
    const tables = document.querySelectorAll('table[id]');
    
    tables.forEach(table => {
        const tableId = table.id;
        
        // Don't reinitialize if already exists
        if (window.tableManagers[tableId]) {
            return;
        }

        // Create manager for this table
        window.tableManagers[tableId] = new TableManager(tableId, { itemsPerPage: 10 });
    });

    console.log(`[TABLE] Initialized ${Object.keys(window.tableManagers).length} table(s)`);
}

// Watch for real-time table updates and reinitialize
const observerConfig = { childList: true, subtree: true };
const observer = new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            // Check if new rows were added to any table
            mutation.addedNodes.forEach(node => {
                if (node.tagName === 'TR') {
                    const table = node.closest('table');
                    if (table && table.id && window.tableManagers[table.id]) {
                        window.tableManagers[table.id].reinitialize();
                    }
                }
            });
        }
    });
});

document.addEventListener('DOMContentLoaded', () => {
    const tables = document.querySelectorAll('table[id] tbody');
    tables.forEach(tbody => {
        observer.observe(tbody, observerConfig);
    });
});

// Add CSS for disabled buttons
const style = document.createElement('style');
style.textContent = `
    table thead th[onclick],
    table thead th[data-sortable] {
        cursor: pointer;
        transition: background-color 0.2s ease !important;
        user-select: none;
    }

    table thead th[onclick]:hover,
    table thead th[data-sortable]:hover {
        background-color: rgba(0, 0, 0, 0.06) !important;
    }

    table thead th[onclick]:active,
    table thead th[data-sortable]:active {
        background-color: rgba(0, 0, 0, 0.08) !important;
    }

    .sort-icon {
        transition: opacity 0.2s ease, transform 0.2s ease;
        display: inline-block;
    }

    button[id*="-prev"]:disabled,
    button[id*="-next"]:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        pointer-events: none;
    }
`;
document.head.appendChild(style);
