const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const processBtn = document.getElementById('processBtn');
const currentSection = document.getElementById('currentSection');
const currentGrid = document.getElementById('currentGrid');
const historySection = document.getElementById('historySection');
const historyGrid = document.getElementById('historyGrid');
const historyCount = document.getElementById('historyCount');

let selectedFiles = [];
let jobMap = {}; // jobId -> { element, data }
let orderMap = {}; // orderId -> { element, grid, countSpan, timeSpan, jobs: Set }
let pollingJobs = new Set();

uploadArea.addEventListener('click', () => fileInput.click());

uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    const files = Array.from(e.dataTransfer.files).filter(isImage);
    addFiles(files);
});

fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files).filter(isImage);
    addFiles(files);
    fileInput.value = '';
});

function isImage(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    return ['jpg', 'jpeg', 'png', 'bmp', 'webp'].includes(ext);
}

function addFiles(files) {
    if (!files.length) return;
    selectedFiles = selectedFiles.concat(files);
    renderSelectedFiles();
    processBtn.disabled = selectedFiles.length === 0;
}

function renderSelectedFiles() {
    if (!selectedFiles.length) {
        updateVisibility();
        return;
    }
    selectedFiles.forEach((file, index) => {
        const tempId = `selected-${index}`;
        if (jobMap[tempId]) return;
        const card = createResultCard(tempId, { status: 'selected', original_name: file.name }, true);
        jobMap[tempId] = { element: card, data: { status: 'selected', original_name: file.name } };
    });
    updateVisibility();
}

processBtn.addEventListener('click', async () => {
    if (!selectedFiles.length) return;

    processBtn.disabled = true;
    processBtn.textContent = '正在上传...';

    const formData = new FormData();
    selectedFiles.forEach(file => formData.append('images', file));

    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData,
        });

        const data = await response.json();

        if (!response.ok) {
            alert(data.error || '上传失败');
            processBtn.disabled = false;
            processBtn.textContent = '开始处理';
            return;
        }

        selectedFiles.forEach((_, index) => {
            const tempId = `selected-${index}`;
            if (jobMap[tempId]) {
                jobMap[tempId].element.remove();
                delete jobMap[tempId];
            }
        });
        selectedFiles = [];

        getOrCreateOrderCard(data.order_id, { order_id: data.order_id, created_at: new Date().toISOString() });

        data.jobs.forEach(job => {
            jobMap[job.id] = {
                element: createResultCard(job.id, job, true),
                data: job,
            };
            startPolling(job.id);
        });

        reorganizeCards();
        processBtn.textContent = '开始处理';
        processBtn.disabled = false;

    } catch (err) {
        alert('上传出错：' + err.message);
        processBtn.disabled = false;
        processBtn.textContent = '开始处理';
    }
});

function getOrCreateOrderCard(orderId, orderData) {
    if (orderMap[orderId]) {
        // Update time if it was missing or we have a better one
        if (orderData.created_at) {
            orderMap[orderId].timeSpan.textContent = formatTime(orderData.created_at);
            orderMap[orderId].timeSpan.dataset.iso = orderData.created_at;
        }
        return orderMap[orderId].element;
    }
    
    const card = document.createElement('div');
    card.className = 'order-card';
    card.id = `order-${orderId}`;
    
    const header = document.createElement('div');
    header.className = 'order-header';
    
    const createdAt = orderData.created_at || new Date().toISOString();
    
    header.innerHTML = `
        <div class="order-info">
            <span class="order-time" data-iso="${createdAt}">${formatTime(createdAt)}</span>
            <span class="order-count">包含 0 张图片</span>
        </div>
        <button class="btn-toggle-order btn-secondary">展开 / 折叠</button>
    `;
    
    const grid = document.createElement('div');
    grid.className = 'results-grid order-grid';
    grid.id = `order-grid-${orderId}`;
    grid.style.display = 'none'; // hidden by default
    
    header.querySelector('.btn-toggle-order').addEventListener('click', () => {
        grid.style.display = grid.style.display === 'none' ? 'grid' : 'none';
    });
    
    card.appendChild(header);
    card.appendChild(grid);
    
    historyGrid.appendChild(card);
    
    orderMap[orderId] = { 
        element: card, 
        grid: grid, 
        countSpan: header.querySelector('.order-count'),
        timeSpan: header.querySelector('.order-time'),
        jobs: new Set() 
    };
    return card;
}

function createResultCard(jobId, jobData, isCurrent) {
    const card = document.createElement('div');
    card.className = 'result-card';
    card.id = `card-${jobId}`;
    card.innerHTML = `
        <div class="card-image" id="img-${jobId}">${renderImagePlaceholder(jobData.status)}</div>
        <div class="card-body">
            <div class="card-title" id="title-${jobId}">${escapeHtml(jobData.original_name || '-')}</div>
            <div class="card-time" id="time-${jobId}">${formatTime(jobData.created_at)}</div>
            <div class="card-status" id="status-${jobId}">${getStatusText(jobData.status)}${jobData.message ? '：' + jobData.message : ''}</div>
            <div class="card-actions" id="actions-${jobId}" style="display:none;">
                <a href="/api/download/${jobId}" class="btn-download" target="_blank">下载</a>
                <a href="/api/preview/${jobId}" class="btn-preview" target="_blank">查看</a>
            </div>
        </div>
    `;

    if (isCurrent) {
        currentGrid.appendChild(card);
    }
    return card;
}

function renderImagePlaceholder(status) {
    if (status === 'done') {
        return '<div class="loading">加载中...</div>';
    }
    if (status === 'error') {
        return '<div class="loading error">❌</div>';
    }
    if (status === 'skipped') {
        return '<div class="loading skip">⚠️</div>';
    }
    return '<div class="loading">处理中...</div>';
}

function startPolling(jobId) {
    if (pollingJobs.has(jobId)) return;
    pollingJobs.add(jobId);
    pollJob(jobId);
}

async function pollJob(jobId) {
    try {
        const response = await fetch(`/api/status/${jobId}`);
        const data = await response.json();

        if (!response.ok) {
            updateCard(jobId, { status: 'error', message: '获取状态失败' });
            pollingJobs.delete(jobId);
            return;
        }

        updateCard(jobId, data);

        if (['done', 'error', 'skipped'].includes(data.status)) {
            pollingJobs.delete(jobId);
            reorganizeCards();
            return;
        }

        setTimeout(() => pollJob(jobId), 1000);
    } catch (err) {
        updateCard(jobId, { status: 'error', message: '网络错误：' + err.message });
        pollingJobs.delete(jobId);
        reorganizeCards();
    }
}

function updateCard(jobId, data) {
    const job = jobMap[jobId];
    if (!job) return;

    job.data = { ...job.data, ...data };

    const imgDiv = document.getElementById(`img-${jobId}`);
    const statusDiv = document.getElementById(`status-${jobId}`);
    const actionsDiv = document.getElementById(`actions-${jobId}`);

    statusDiv.textContent = `${getStatusText(data.status)}${data.message ? '：' + data.message : ''}`;
    statusDiv.className = `card-status status-${data.status}`;

    if (data.status === 'done') {
        imgDiv.innerHTML = `<img src="/api/preview/${jobId}?t=${Date.now()}" alt="处理结果">`;
        actionsDiv.style.display = 'flex';
    } else if (data.status === 'error' || data.status === 'skipped') {
        imgDiv.innerHTML = renderImagePlaceholder(data.status);
        actionsDiv.style.display = 'none';
    }
}

function reorganizeCards() {
    const activeStatuses = ['pending', 'processing', 'selected'];
    
    Object.values(jobMap).forEach(({ element, data }) => {
        if (activeStatuses.includes(data.status)) {
            if (element.parentElement !== currentGrid) {
                currentGrid.appendChild(element);
            }
        } else {
            const orderId = data.order_id || data.id;
            if (!orderMap[orderId]) {
                 getOrCreateOrderCard(orderId, { order_id: orderId, created_at: data.created_at });
            }
            const orderGrid = orderMap[orderId].grid;
            if (element.parentElement !== orderGrid) {
                orderGrid.appendChild(element);
            }
            orderMap[orderId].jobs.add(data.id);
        }
    });
    
    let historyOrderCount = 0;
    Object.values(orderMap).forEach(order => {
        const count = order.jobs.size;
        order.countSpan.textContent = `包含 ${count} 张图片`;
        if (count > 0) historyOrderCount++;
        order.element.style.display = count > 0 ? 'block' : 'none';
    });

    sortHistoryOrders();
    updateVisibility(historyOrderCount);
}

function sortHistoryOrders() {
    const cards = Array.from(historyGrid.children);
    cards.sort((a, b) => {
        const idA = a.id.replace('order-', '');
        const idB = b.id.replace('order-', '');
        const timeA = orderMap[idA]?.timeSpan.dataset.iso || '';
        const timeB = orderMap[idB]?.timeSpan.dataset.iso || '';
        return timeB.localeCompare(timeA);
    });
    cards.forEach(card => historyGrid.appendChild(card));
}

function updateVisibility(historyOrderCount = 0) {
    if (historyOrderCount === 0) {
        historyOrderCount = Array.from(historyGrid.children).filter(c => c.style.display !== 'none').length;
    }
    const hasCurrent = currentGrid.children.length > 0;
    const hasHistory = historyOrderCount > 0;
    currentSection.style.display = hasCurrent ? 'block' : 'none';
    historySection.style.display = hasHistory ? 'block' : 'none';
    historyCount.textContent = hasHistory ? `共 ${historyOrderCount} 个订单` : '';
}

async function loadExistingJobs() {
    try {
        const response = await fetch('/api/jobs');
        const data = await response.json();
        if (!response.ok) return;

        if (data.orders) {
            data.orders.forEach(order => {
                getOrCreateOrderCard(order.order_id, order);
            });
        }

        data.jobs.forEach(job => {
            if (jobMap[job.id]) return;
            const isActive = ['pending', 'processing'].includes(job.status);
            const card = createResultCard(job.id, job, isActive);
            jobMap[job.id] = { element: card, data: job };
            
            if (!isActive) {
                updateCard(job.id, job); // Display fix: Load image immediately
            } else {
                startPolling(job.id);
            }
        });

        reorganizeCards();
    } catch (err) {
        console.error('加载历史任务失败：', err);
    }
}

function getStatusText(status) {
    const map = {
        selected: '待上传',
        pending: '等待处理',
        processing: '正在处理',
        done: '完成',
        error: '失败',
        skipped: '已跳过',
    };
    return map[status] || status;
}

function formatTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', loadExistingJobs);
