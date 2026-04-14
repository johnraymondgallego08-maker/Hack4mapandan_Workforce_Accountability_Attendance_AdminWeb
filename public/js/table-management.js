(function () {
    function parseColumnIndex(value) {
        if (value === undefined || value === null || value === '') return null;
        const parsed = Number.parseInt(value, 10);
        return Number.isNaN(parsed) ? null : parsed;
    }

    function resolveElement(target) {
        if (!target) return null;
        if (typeof target === 'string') return document.querySelector(target);
        return target;
    }

    function normalizeText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function parseComparableValue(value) {
        const raw = String(value || '').replace(/\s+/g, ' ').trim();
        const numeric = raw.replace(/[$₱,%h]/g, '').replace(/,/g, '');

        if (numeric && /^-?\d+(\.\d+)?$/.test(numeric)) {
            return { type: 'number', value: Number(numeric) };
        }

        const dateValue = Date.parse(raw);
        if (!Number.isNaN(dateValue) && /[/:,-]/.test(raw)) {
            return { type: 'date', value: dateValue };
        }

        return { type: 'text', value: raw.toLowerCase() };
    }

    function isEmptyStateRow(row) {
        return row.dataset.emptyState === 'true'
            || (row.children.length === 1 && row.children[0].hasAttribute('colspan'));
    }

    window.initTableManagement = function initTableManagement(
        tableSelector = 'table',
        searchInputSelector = '#searchInput',
        paginationControlsSelector = '.pagination-controls',
        rowsPerPage = 5,
        options = {}
    ) {
        const table = resolveElement(tableSelector);
        if (!table) return null;

        const tbody = table.querySelector('tbody');
        if (!tbody) return null;

        const searchInput = resolveElement(searchInputSelector);
        const paginationControls = resolveElement(paginationControlsSelector);
        const statusFilter = resolveElement(options.statusFilterSelector || '#statusFilter');
        const dateFilter = resolveElement(options.dateFilterSelector || '#dateFilter');

        const allRows = Array.from(tbody.querySelectorAll('tr'));
        const emptyStateRows = allRows.filter(isEmptyStateRow);
        const dataRows = allRows.filter((row) => !isEmptyStateRow(row));
        const headers = Array.from(table.querySelectorAll('thead th'));

        // If the server-side template did not include an explicit empty-state row,
        // create one so that search/status/date filtering shows a "No records found" message.
        const emptyMessage = options.emptyMessage || 'No records found.';
        if (emptyStateRows.length === 0) {
            const colCount = headers.length || (allRows[0] ? allRows[0].children.length : 1);
            const emptyTr = document.createElement('tr');
            emptyTr.dataset.emptyState = 'true';
            const td = document.createElement('td');
            td.colSpan = colCount;
            td.style.padding = '3rem';
            td.style.textAlign = 'center';
            td.style.color = 'var(--text-muted)';
            td.style.fontStyle = 'italic';
            td.textContent = emptyMessage;
            emptyTr.appendChild(td);
            tbody.appendChild(emptyTr);
            emptyStateRows.push(emptyTr);
        }

        let filteredRows = [...dataRows];
        let currentPage = 1;
        let currentSortColumn = null;
        let currentSortDirection = 'asc';

        function getStatusText(row) {
            if (!statusFilter) return '';

            const explicitColumn = parseColumnIndex(statusFilter.dataset.statusColumn);
            if (explicitColumn !== null && explicitColumn >= 0 && row.children[explicitColumn]) {
                return normalizeText(row.children[explicitColumn].textContent);
            }

            const badge = row.querySelector('.status-badge');
            return badge ? normalizeText(badge.textContent) : '';
        }

        function passesDateFilter(row) {
            if (!dateFilter || !dateFilter.value) return true;

            const singleDateColumn = parseColumnIndex(dateFilter.dataset.dateColumn);
            const startDateColumn = parseColumnIndex(dateFilter.dataset.startDateColumn);
            const endDateColumn = parseColumnIndex(dateFilter.dataset.endDateColumn);
            const activeDate = dateFilter.value;

            if (startDateColumn !== null && endDateColumn !== null) {
                const startText = row.children[startDateColumn] ? row.children[startDateColumn].textContent.trim() : '';
                const endText = row.children[endDateColumn] ? row.children[endDateColumn].textContent.trim() : '';
                return activeDate >= startText && activeDate <= endText;
            }

            if (singleDateColumn !== null && row.children[singleDateColumn]) {
                return row.children[singleDateColumn].textContent.trim() === activeDate;
            }

            return true;
        }

        function syncEmptyState() {
            emptyStateRows.forEach((row) => {
                row.style.display = filteredRows.length === 0 ? '' : 'none';
            });
        }

        function updateSortIndicators() {
            headers.forEach((header, index) => {
                if (header.dataset.sortable !== 'true') return;

                let indicator = header.querySelector('.sort-indicator');
                if (!indicator) {
                    indicator = document.createElement('span');
                    indicator.className = 'sort-indicator';
                    indicator.setAttribute('aria-hidden', 'true');
                    header.appendChild(indicator);
                }

                if (currentSortColumn === index) {
                    indicator.textContent = currentSortDirection === 'asc' ? '▲' : '▼';
                    header.setAttribute('aria-sort', currentSortDirection === 'asc' ? 'ascending' : 'descending');
                } else {
                    indicator.textContent = '↕';
                    header.setAttribute('aria-sort', 'none');
                }
            });
        }

        function reorderRows() {
            const hiddenRows = dataRows.filter((row) => !filteredRows.includes(row));
            filteredRows.forEach((row) => tbody.appendChild(row));
            hiddenRows.forEach((row) => tbody.appendChild(row));
            emptyStateRows.forEach((row) => tbody.appendChild(row));
        }

        function displayPage(page) {
            const totalPages = Math.max(1, Math.ceil(filteredRows.length / rowsPerPage));
            currentPage = Math.min(Math.max(page, 1), totalPages);

            dataRows.forEach((row) => {
                row.style.display = 'none';
            });

            const startIndex = (currentPage - 1) * rowsPerPage;
            filteredRows.slice(startIndex, startIndex + rowsPerPage).forEach((row) => {
                row.style.display = '';
            });

            if (paginationControls) {
                paginationControls.querySelectorAll('.page-btn[data-page]').forEach((button) => {
                    button.classList.toggle('active', Number(button.dataset.page) === currentPage);
                });

                const prevButton = paginationControls.querySelector('.page-btn[data-nav="prev"]');
                const nextButton = paginationControls.querySelector('.page-btn[data-nav="next"]');
                if (prevButton) prevButton.disabled = currentPage === 1;
                if (nextButton) nextButton.disabled = currentPage === totalPages || filteredRows.length === 0;
            }

            syncEmptyState();
        }

        function renderPagination() {
            if (!paginationControls) {
                displayPage(currentPage);
                return;
            }

            paginationControls.innerHTML = '';
            const totalPages = Math.ceil(filteredRows.length / rowsPerPage);

            if (totalPages <= 1) {
                displayPage(1);
                return;
            }

            const prevButton = document.createElement('button');
            prevButton.type = 'button';
            prevButton.className = 'page-btn';
            prevButton.dataset.nav = 'prev';
            prevButton.textContent = 'Prev';
            prevButton.addEventListener('click', () => displayPage(currentPage - 1));
            paginationControls.appendChild(prevButton);

            for (let i = 1; i <= totalPages; i += 1) {
                const pageButton = document.createElement('button');
                pageButton.type = 'button';
                pageButton.className = 'page-btn';
                pageButton.dataset.page = String(i);
                pageButton.textContent = String(i);
                pageButton.addEventListener('click', () => displayPage(i));
                paginationControls.appendChild(pageButton);
            }

            const nextButton = document.createElement('button');
            nextButton.type = 'button';
            nextButton.className = 'page-btn';
            nextButton.dataset.nav = 'next';
            nextButton.textContent = 'Next';
            nextButton.addEventListener('click', () => displayPage(currentPage + 1));
            paginationControls.appendChild(nextButton);

            displayPage(currentPage);
        }

        function sortRows(columnIndex) {
            if (currentSortColumn === columnIndex) {
                currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortColumn = columnIndex;
                currentSortDirection = 'asc';
            }

            filteredRows.sort((rowA, rowB) => {
                const textA = rowA.children[columnIndex] ? rowA.children[columnIndex].textContent.trim() : '';
                const textB = rowB.children[columnIndex] ? rowB.children[columnIndex].textContent.trim() : '';
                const parsedA = parseComparableValue(textA);
                const parsedB = parseComparableValue(textB);

                let comparison = 0;
                if (parsedA.type === parsedB.type) {
                    if (parsedA.value < parsedB.value) comparison = -1;
                    if (parsedA.value > parsedB.value) comparison = 1;
                } else {
                    comparison = textA.localeCompare(textB);
                }

                return currentSortDirection === 'asc' ? comparison : -comparison;
            });

            reorderRows();
            updateSortIndicators();
            displayPage(1);
        }

        function applyFilters(resetPage = true) {
            const searchValue = normalizeText(searchInput ? searchInput.value : '');
            const statusValue = normalizeText(statusFilter ? statusFilter.value : '');

            filteredRows = dataRows.filter((row) => {
                const matchesSearch = !searchValue || normalizeText(row.textContent).includes(searchValue);
                const matchesStatus = !statusValue || statusValue === 'all' || getStatusText(row).includes(statusValue);
                return matchesSearch && matchesStatus && passesDateFilter(row);
            });

            if (currentSortColumn !== null) {
                filteredRows.sort((rowA, rowB) => {
                    const textA = rowA.children[currentSortColumn] ? rowA.children[currentSortColumn].textContent.trim() : '';
                    const textB = rowB.children[currentSortColumn] ? rowB.children[currentSortColumn].textContent.trim() : '';
                    const parsedA = parseComparableValue(textA);
                    const parsedB = parseComparableValue(textB);

                    let comparison = 0;
                    if (parsedA.type === parsedB.type) {
                        if (parsedA.value < parsedB.value) comparison = -1;
                        if (parsedA.value > parsedB.value) comparison = 1;
                    } else {
                        comparison = textA.localeCompare(textB);
                    }

                    return currentSortDirection === 'asc' ? comparison : -comparison;
                });
                reorderRows();
            }

            if (resetPage) currentPage = 1;
            renderPagination();
        }

        if (searchInput) {
            searchInput.addEventListener('input', () => applyFilters());
        }

        if (statusFilter) {
            statusFilter.addEventListener('change', () => applyFilters());
        }

        if (dateFilter) {
            dateFilter.addEventListener('change', () => applyFilters());
        }

        headers.forEach((header, index) => {
            if (header.dataset.sortable !== 'true') return;
            header.style.cursor = 'pointer';
            header.addEventListener('click', () => sortRows(index));
        });

        updateSortIndicators();
        applyFilters();

        return {
            refresh: () => applyFilters(false),
            sortBy: sortRows
        };
    };
}());
