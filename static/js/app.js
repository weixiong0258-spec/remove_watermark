const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const processBtn = document.getElementById('processBtn');
const currentSection = document.getElementById('currentSection');
const currentGrid = document.getElementById('currentGrid');
const historySection = document.getElementById('historySection');
const historyGrid = document.getElementById('historyGrid');
const historyCount = document.getElementById('historyCount');

let selectedFiles = []; // Array of { file, tempId, previewUrl }
let jobMap = {}; // jobId -> { element, data }
let orderMap = {}; // orderId -> { element, grid, countSpan, timeSpan, jobs: Set }
let pollingJobs = new Set();

console.log('App initialized. Version 6 (Local Preview Fix).');

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
    
    files.forEach(file => {
        const tempId = `selected-${Math.random().toString(36).substr(2, 9)}`;
        const previewUrl = URL.createObjectURL(file);
        selectedFiles.push({ file, tempId, previewUrl });
        
        const card = createResultCard(tempId, { 
            status: 'selected', 
            original_name: file.name,
            previewUrl: previewUrl 
        }, true);
        
        jobMap[tempId] = { 
            element: card, 
            data: { status: 'selected', original_name: file.name, previewUrl: previewUrl } 
        };
    });

    updateVisibility();
    processBtn.disabled = selectedFiles.length === 0;
    console.log(`Added ${files.length} files. Total selected: ${selectedFiles.length}`);
}

processBtn.addEventListener('click', async () => {
    if (!selectedFiles.length) return;

    console.log('Start Processing button clicked.');
    const filesToUpload = [...selectedFiles];
    processBtn.disabled = true;
    processBtn.textContent = '正在上传并启动任务...';

    const formData = new FormData();
    filesToUpload.forEach(item => formData.append('images', item.file));

    try {
        console.log('Sending upload request to /api/upload...');
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData,
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('Upload failed:', data);
            alert(data.error || '上传失败');
            processBtn.disabled = false;
            processBtn.textContent = '开始处理';
            return;
        }

        console.log('Upload success, order_id:', data.order_id, 'jobs:', data.jobs.length);

        // Remove all selected placeholders
        filesToUpload.forEach(item => {
            if (jobMap[item.tempId]) {
                jobMap[item.tempId].element.remove();
                delete jobMap[item.tempId];
            }
            if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        });
        selectedFiles = [];

        getOrCreateOrderCard(data.order_id, { order_id: data.order_id, created_at: new Date().toISOString() });

        data.jobs.forEach(job => {
            const card = createResultCard(job.id, job, true);
            jobMap[job.id] = {
                element: card,
                data: job,
            };
            updateCard(job.id, job);
            startPolling(job.id);
        });

        reorganizeCards();
        processBtn.textContent = '开始处理';
        processBtn.disabled = true; // Disabled because selectedFiles is now empty

    } catch (err) {
        console.error('Upload error:', err);
        alert('上传出错：' + err.message);
        processBtn.disabled = false;
        processBtn.textContent = '开始处理';
    }
});

function getOrCreateOrderCard(orderId, orderData) {
    if (orderMap[orderId]) {
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
    grid.style.display = 'grid'; // show by default for new/current orders
    
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
        <div class="card-image" id="img-${jobId}">${renderImagePlaceholder(jobData.status, jobId, jobData.previewUrl)}</div>
        <div class="card-body">
            <div class="card-title" id="title-${jobId}">${escapeHtml(jobData.original_name || '-')}</div>
            <div class="card-time" id="time-${jobId}">${formatTime(jobData.created_at)}</div>
            <div class="card-status" id="status-${jobId}">${getStatusText(jobData.status)}${jobData.message ? '：' + jobData.message : ''}</div>
            <div class="card-actions" id="actions-${jobId}" style="display:none;">
                <a href="/api/download/${jobId}" class="btn-download" target="_blank">下载</a>
                <a href="/api/preview/${jobId}" class="btn-preview" target="_blank">预览结果</a>
                <button class="btn-delete" onclick="deleteJob('${jobId}')">删除记录</button>
            </div>
        </div>
    `;

    if (isCurrent) {
        currentGrid.appendChild(card);
    }
    return card;
}

function renderImagePlaceholder(status, jobId, previewUrl) {
    if (status === 'selected' && previewUrl) {
        return `<img src="${previewUrl}" alt="待上传" style="opacity: 0.5; filter: grayscale(100%);">`;
    }
    if (status === 'done' || status === 'pending' || status === 'processing') {
        const endpoint = (status === 'done') ? `/api/preview/${jobId}` : `/api/preview_input/${jobId}`;
        return `<img src="${endpoint}?t=${Date.now()}" alt="图片" style="opacity: ${status === 'done' ? '1' : '0.5'};">`;
    }
    if (status === 'error') {
        return '<div class="loading error">❌</div>';
    }
    if (status === 'skipped') {
        return '<div class="loading skip">⚠️</div>';
    }
    return '<div class="loading">准备中...</div>';
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

    if (statusDiv) {
        statusDiv.textContent = `${getStatusText(data.status)}${data.message ? '：' + data.message : ''}`;
        statusDiv.className = `card-status status-${data.status}`;
    }

    if (imgDiv) {
        if (data.status === 'done') {
            imgDiv.innerHTML = `<img src="/api/preview/${jobId}?t=${Date.now()}" alt="处理结果">`;
            if (actionsDiv) actionsDiv.style.display = 'flex';
        } else if (data.status === 'error' || data.status === 'skipped') {
            imgDiv.innerHTML = renderImagePlaceholder(data.status, jobId);
            if (actionsDiv) actionsDiv.style.display = 'none';
        } else if (data.status === 'pending' || data.status === 'processing') {
            const currentImg = imgDiv.querySelector('img');
            if (!currentImg || currentImg.src.includes('blob:')) {
                imgDiv.innerHTML = renderImagePlaceholder(data.status, jobId);
            } else {
                currentImg.style.opacity = '0.5';
            }
        }
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
    const hasCurrent = currentGrid.children.length > 0;
    const hasHistory = Array.from(historyGrid.children).some(c => c.style.display !== 'none');
    
    currentSection.style.display = hasCurrent ? 'block' : 'none';
    historySection.style.display = hasHistory ? 'block' : 'none';
    
    if (hasHistory) {
        const actualCount = Array.from(historyGrid.children).filter(c => c.style.display !== 'none').length;
        historyCount.textContent = `共 ${actualCount} 个订单`;
    }
}

async function loadExistingJobs() {
    try {
        console.log('Loading existing jobs...');
        const response = await fetch('/api/jobs');
        const data = await response.json();
        if (!response.ok) return;

        console.log('Loaded jobs count:', data.jobs.length);

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
                updateCard(job.id, job);
            } else {
                startPolling(job.id);
            }
        });

        reorganizeCards();
    } catch (err) {
        console.error('加载历史任务失败：', err);
    }
}

async function deleteJob(jobId) {
    if (!confirm('确定要删除这条记录及其文件吗？')) return;
    
    try {
        const response = await fetch(`/api/delete/${jobId}`, { method: 'DELETE' });
        if (response.ok) {
            const job = jobMap[jobId];
            if (job) {
                const orderId = job.data.order_id || job.data.id;
                job.element.remove();
                delete jobMap[jobId];
                
                if (orderMap[orderId]) {
                    orderMap[orderId].jobs.delete(jobId);
                    reorganizeCards();
                }
            }
        } else {
            alert('删除失败');
        }
    } catch (err) {
        alert('删除出错：' + err.message);
    }
}

function getStatusText(status) {
    const map = {
        selected: '待上传 (请点击下方按钮开始)',
        pending: '队列中',
        processing: '正在去水印',
        done: '处理完成',
        error: '处理失败',
        skipped: '已跳过 (未检测到水印)',
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

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', loadExistingJobs);
