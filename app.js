// Supabase Configuration
const SUPABASE_URL = 'https://cxcnnhafchqslvgvkeye.supabase.co';
const SUPABASE_KEY = 'sb_publishable_5xHLDxmk5vqAhdQzaPMG7Q_sQMqqKiF';
const supabaseClient = (typeof supabase !== 'undefined') 
    ? supabase.createClient(SUPABASE_URL, SUPABASE_KEY) 
    : (alert('Supabase Library NOT FOUND! Check if supabase.js is in the folder.'), null);

// DOM Elements for Connection Status
const statusBadge = document.getElementById('connection-status');
const statusText = statusBadge?.querySelector('.status-text');

// Offline Store using IndexedDB
const DB_NAME = 'SuperPOS_DB';
const DB_VERSION = 1;

class OfflineStore {
    constructor() {
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onerror = (event) => reject('Database error: ' + event.target.errorCode);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('clients')) {
                    db.createObjectStore('clients', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('sync_queue')) {
                    db.createObjectStore('sync_queue', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('categories')) {
                    db.createObjectStore('categories', { keyPath: 'id' });
                }
            };
            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };
        });
    }

    async saveClient(client, isPending = false, offlineData = null) {
        const tx = this.db.transaction(['clients', 'sync_queue'], 'readwrite');
        tx.objectStore('clients').put(client);
        if (isPending) {
            tx.objectStore('sync_queue').put({ 
                id: client.id, 
                data: offlineData || client, 
                type: 'CLIENT_FULL_SAVE' 
            });
        }
        return new Promise((resolve) => tx.oncomplete = () => resolve());
    }

    async getClients() {
        return new Promise((resolve) => {
            const tx = this.db.transaction('clients', 'readonly');
            const store = tx.objectStore('clients');
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
        });
    }

    async saveCategories(categories) {
        const tx = this.db.transaction('categories', 'readwrite');
        const store = tx.objectStore('categories');
        categories.forEach(cat => store.put(cat));
        return new Promise((resolve) => tx.oncomplete = () => resolve());
    }

    async getCategories() {
        return new Promise((resolve) => {
            const tx = this.db.transaction('categories', 'readonly');
            const store = tx.objectStore('categories');
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
        });
    }

    async getSyncQueue() {
        return new Promise((resolve) => {
            const tx = this.db.transaction('sync_queue', 'readonly');
            const store = tx.objectStore('sync_queue');
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
        });
    }

    async removeFromSyncQueue(id) {
        const tx = this.db.transaction('sync_queue', 'readwrite');
        tx.objectStore('sync_queue').delete(id);
        return new Promise((resolve) => tx.oncomplete = () => resolve());
    }
}

const offlineStore = new OfflineStore();
let currentCategories = [];

// DOM Elements
const searchInput = document.getElementById('customer-search');
const initialState = document.getElementById('initial-state');
const customerResult = document.getElementById('customer-result');
const newCustomerForm = document.getElementById('new-customer-form');

// Result fields
const resName = document.getElementById('res-name');
const resCategory = document.getElementById('res-category');
const resPoints = document.getElementById('res-points');
const resPhone = document.getElementById('res-phone');
const resEmail = document.getElementById('res-email');

// Form fields
const formPhone = document.getElementById('form-phone');
const addCustomerForm = document.getElementById('add-customer-form');
const btnCancel = document.getElementById('btn-cancel');

// Config View Elements
const configView = document.getElementById('config-view');
const appContainer = document.querySelector('.app-container');
const categoryList = document.getElementById('category-list');
const addCategoryForm = document.getElementById('add-category-form');
const btnOpenConfig = document.getElementById('btn-open-config');
const btnCloseConfig = document.getElementById('btn-close-config');

// Search Logic
async function performSearch() {
    const query = searchInput.value.trim();

    if (query.length === 0) {
        showSection('initial');
        return;
    }

    let foundCustomer = null;

    try {
        if (navigator.onLine) {
            // Online search: prioritized by phone or first_name
            const { data, error } = await supabaseClient
                .from('clients')
                .select('*, client_categories(name)')
                .or(`phone.ilike.%${query}%,first_name.ilike.%${query}%,email.ilike.%${query}%`)
                .limit(1)
                .maybeSingle();

            if (error) throw error;

            if (data) {
                foundCustomer = {
                    ...data,
                    category: data.client_categories?.name || 'General Public',
                    points: data.loyalty_points || 0
                };
            }
        } 
        
        // If not found online (or offline), try local
        if (!foundCustomer) {
            const localClients = await offlineStore.getClients();
            foundCustomer = localClients.find(c => 
                c.phone.includes(query) || 
                (c.first_name + ' ' + (c.last_name || '')).toLowerCase().includes(query.toLowerCase())
            );
        }

        if (foundCustomer) {
            displayCustomer(foundCustomer);
        } else {
            showNewCustomerForm(query);
        }
    } catch (err) {
        console.error('Search error:', err);
        // Fallback to local on any error
        const localClients = await offlineStore.getClients();
        const foundLocal = localClients.find(c => 
            c.phone.includes(query) || 
            (c.first_name + ' ' + (c.last_name || '')).toLowerCase().includes(query.toLowerCase())
        );
        if (foundLocal) displayCustomer(foundLocal);
        else showNewCustomerForm(query);
    }
}

searchInput.addEventListener('input', performSearch);
document.getElementById('btn-manual-search').addEventListener('click', performSearch);

function displayCustomer(customer) {
    resName.textContent = `${customer.first_name} ${customer.last_name || ''}`;
    resCategory.textContent = customer.category;
    resCategory.className = `badge ${customer.category.toLowerCase().replace(/\s+/g, '-')}`;
    resPoints.textContent = customer.loyalty_points || 0;
    resPhone.textContent = formatPhone(customer.phone);
    resEmail.textContent = customer.email || 'N/A';

    showSection('result');
}

function showNewCustomerForm(query) {
    // Basic heuristic: if query is mostly numbers, pre-fill phone
    if (/^\d+$/.test(query.replace(/[-\s]/g, ''))) {
        formPhone.value = query;
    } else {
        formPhone.value = '';
    }
    
    showSection('form');
}

function showSection(section) {
    initialState.classList.add('hidden');
    customerResult.classList.add('hidden');
    newCustomerForm.classList.add('hidden');

    if (section === 'initial') initialState.classList.remove('hidden');
    if (section === 'result') customerResult.classList.remove('hidden');
    if (section === 'form') newCustomerForm.classList.remove('hidden');
}

// Utility to format phone display
function formatPhone(phone) {
    return phone.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
}

// Helper to generate UUID v4
function generateUUID() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
}

// Form Handlers
addCustomerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const clientId = generateUUID();
    const clientData = {
        id: clientId,
        first_name: document.getElementById('form-name').value,
        last_name: document.getElementById('form-lastname').value,
        phone: document.getElementById('form-phone').value,
        email: document.getElementById('form-email').value,
        category_id: document.getElementById('form-category').value || null,
        tax_id: document.getElementById('form-tax-id').value,
        created_at: new Date().toISOString(),
        loyalty_points: 0
    };

    const street = document.getElementById('form-street').value;
    const addressData = street ? {
        id: generateUUID(),
        client_id: clientId,
        street_and_number: street,
        city: 'Hermosillo',
        is_default: true,
        created_at: new Date().toISOString()
    } : null;

    try {
        if (navigator.onLine) {
            // Save Client
            const { error: clientError } = await supabaseClient.from('clients').insert([clientData]);
            if (clientError) throw clientError;
            
            // Save Address if provided
            if (addressData) {
                const { error: addrError } = await supabaseClient.from('client_addresses').insert([addressData]);
                if (addrError) console.error('Address error:', addrError);
            }

            alert(`Success: ${clientData.first_name} created on Cloud.`);
        } else {
            // Save locally and queue for sync
            const offlineData = {
                client: clientData,
                address: addressData
            };
            await offlineStore.saveClient(clientData, true, offlineData);
            alert(`Stored offline: ${clientData.first_name}. Will sync when connection returns.`);
        }
        
        displayCustomer({ 
            ...clientData, 
            category: currentCategories.find(c => c.id === clientData.category_id)?.name || 'General Public' 
        });
    } catch (err) {
        console.error('Save error:', err);
        alert('Critical error saving to cloud. Storing locally as backup.');
        await offlineStore.saveClient(clientData, true);
    }
});

btnCancel.addEventListener('click', () => {
    searchInput.value = '';
    searchInput.focus();
    showSection('initial');
});

// View Switching Logic
btnOpenConfig.addEventListener('click', () => {
    configView.classList.remove('hidden');
    // Hide all main POS sections
    initialState.classList.add('hidden');
    customerResult.classList.add('hidden');
    newCustomerForm.classList.add('hidden');
    searchInput.parentElement.parentElement.classList.add('hidden'); // Hide search box
    renderCategories();
});

btnCloseConfig.addEventListener('click', () => {
    configView.classList.add('hidden');
    searchInput.parentElement.parentElement.classList.remove('hidden'); // Show search box
    showSection('initial');
});

// Category Management Logic
async function renderCategories() {
    categoryList.innerHTML = '<div class="empty-state" style="padding: 2rem; grid-column: 1 / -1;"><p>Updating list...</p></div>';
    
    const { data: categories, error } = await supabaseClient
        .from('client_categories')
        .select('*')
        .order('name');

    if (error) {
        categoryList.innerHTML = `<p style="color: red; padding: 1rem;">Error loading categories: ${error.message}</p>`;
        return;
    }

    if (!categories || categories.length === 0) {
        categoryList.innerHTML = '<div class="empty-state" style="padding: 2rem; grid-column: 1 / -1;"><p>No categories found. Add one above!</p></div>';
        return;
    }

    categoryList.innerHTML = '';
    categories.forEach(cat => {
        const card = document.createElement('div');
        card.className = 'category-card';
        card.innerHTML = `
            <div class="category-info">
                <h3>${cat.name}</h3>
                <p>Discount: ${cat.discount_percentage || 0}%</p>
            </div>
            <button class="btn-icon delete-cat" data-id="${cat.id}" title="Delete Category">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        `;
        categoryList.appendChild(card);
    });

    // Add Delete Listeners
    document.querySelectorAll('.delete-cat').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.getAttribute('data-id');
            if (confirm('Are you sure you want to delete this category? This might affect existing clients.')) {
                const { error } = await supabaseClient.from('client_categories').delete().eq('id', id);
                if (error) {
                    alert('Error deleting category: ' + error.message);
                } else {
                    // Update local state and UI
                    await refreshCategories();
                    renderCategories();
                }
            }
        });
    });
}

addCategoryForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('cat-name').value;
    const discount = parseFloat(document.getElementById('cat-discount').value) || 0;

    const { error } = await supabaseClient
        .from('client_categories')
        .insert([{ id: generateUUID(), name, discount_percentage: discount }]);

    if (error) {
        alert('Error adding category: ' + error.message);
    } else {
        addCategoryForm.reset();
        await refreshCategories();
        renderCategories();
    }
});

async function refreshCategories() {
    const { data: categories } = await supabaseClient.from('client_categories').select('*').order('name');
    if (categories) {
        currentCategories = categories;
        await offlineStore.saveCategories(categories);
        populateCategoryDropdown(categories);
    }
}

// Sync Logic
async function syncData() {
    if (!navigator.onLine) return;

    const queue = await offlineStore.getSyncQueue();
    if (queue.length === 0) return;

    console.log(`Syncing ${queue.length} records...`);
    statusText.textContent = 'Syncing...';

    for (const item of queue) {
        try {
            if (item.type === 'CLIENT_FULL_SAVE') {
                const { client, address } = item.data;
                
                // Save Client
                const { error: clientError } = await supabaseClient.from('clients').insert([client]);
                if (clientError) throw clientError;

                // Save Address if exists
                if (address) {
                    const { error: addrError } = await supabaseClient.from('client_addresses').insert([address]);
                    if (addrError) console.error('Address sync error:', addrError);
                }

                await offlineStore.removeFromSyncQueue(item.id);
            }
        } catch (err) {
            console.error('Sync failed for item:', item.id, err);
        }
    }

    statusBadge.className = 'status-badge online';
    statusText.textContent = 'Online';
}

// Online/Offline Events
window.addEventListener('online', () => {
    statusBadge.className = 'status-badge online';
    statusText.textContent = 'Online';
    syncData();
});

window.addEventListener('offline', () => {
    statusBadge.className = 'status-badge offline';
    statusText.textContent = 'Offline';
});

// Initial Data Load
async function initApp() {
    await offlineStore.init();
    
    // Check initial online status
    if (navigator.onLine) {
        statusBadge.className = 'status-badge online';
        statusText.textContent = 'Online';
        
        // Fetch categories to populate dropdown
        const { data: categories } = await supabaseClient.from('client_categories').select('*');
        if (categories) {
            currentCategories = categories;
            await offlineStore.saveCategories(categories);
            populateCategoryDropdown(categories);
        }
        
        syncData();
    } else {
        statusBadge.className = 'status-badge offline';
        statusText.textContent = 'Offline';
        const categories = await offlineStore.getCategories();
        populateCategoryDropdown(categories);
    }
}

function populateCategoryDropdown(categories) {
    const select = document.getElementById('form-category');
    select.innerHTML = '<option value="">General Public</option>';
    categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = cat.name;
        select.appendChild(opt);
    });
}

initApp();

// Key Shortcuts
document.addEventListener('keydown', (e) => {
    // Focus search on Ctrl+F or /
    if ((e.ctrlKey && e.key === 'f') || e.key === '/') {
        if (document.activeElement !== searchInput) {
            e.preventDefault();
            searchInput.focus();
            searchInput.select();
        }
    }
});
