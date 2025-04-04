/**
 * User Authentication App
 * Frontend JavaScript
 */

// App state
const appState = {
    token: null,
    user: null,
    isLoading: false,
    errors: {}
};

// DOM elements
const domElements = {
    loginForm: null,
    registerForm: null,
    loginFormContainer: null,
    registerFormContainer: null,
    loginLink: null,
    registerLink: null,
    logoutBtn: null,
    alerts: {},
    welcomeMessage: null
};

// API URLs
const API = {
    login: '/api/token',
    register: '/api/register',
    me: '/api/users/me'
};

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    // Cache DOM elements
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const loginFormContainer = document.getElementById('login-form-container');
    const registerFormContainer = document.getElementById('register-form-container');
    const loginLink = document.getElementById('login-link');
    const registerLink = document.getElementById('register-link');
    const logoutBtn = document.getElementById('logout-btn');
    const welcomeMessage = document.getElementById('welcome-message');
    const loginAlert = document.getElementById('login-alert');
    const registerAlert = document.getElementById('register-alert');

    // Check if we're on the profile page and there's a token
    if (window.location.pathname === '/profile') {
        const token = localStorage.getItem('token');
        if (!token) {
            // Redirect to login page if no token found
            window.location.href = '/';
            return;
        }
        
        // Fetch user data
        fetchUserData(token);
    }

    // Setup login form
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const username = document.getElementById('login-username').value;
            const password = document.getElementById('login-password').value;
            
            try {
                const response = await fetch(API.login, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    // Save token and redirect to profile
                    localStorage.setItem('token', data.access_token);
                    window.location.href = '/profile';
                } else {
                    showAlert(loginAlert, data.detail || 'Неверное имя пользователя или пароль', 'danger');
                }
            } catch (error) {
                console.error('Login error:', error);
                showAlert(loginAlert, 'Ошибка соединения с сервером', 'danger');
            }
        });
    }

    // Setup registration form
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const username = document.getElementById('register-username').value;
            const password = document.getElementById('register-password').value;
            const email = document.getElementById('register-email')?.value || null;
            
            try {
                const response = await fetch(API.register, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ username, password, email }),
                });
                
                if (response.ok) {
                    showAlert(registerAlert, 'Регистрация успешна! Теперь вы можете войти', 'success');
                    // Clear the form
                    registerForm.reset();
                    
                    // Show login form after successful registration
                    setTimeout(() => {
                        showForm(loginFormContainer, registerFormContainer);
                    }, 2000);
                } else {
                    const data = await response.json();
                    showAlert(registerAlert, data.detail || 'Ошибка регистрации', 'danger');
                }
            } catch (error) {
                console.error('Registration error:', error);
                showAlert(registerAlert, 'Ошибка соединения с сервером', 'danger');
            }
        });
    }

    // Setup form switchers
    if (loginLink) {
        loginLink.addEventListener('click', (e) => {
            e.preventDefault();
            showForm(loginFormContainer, registerFormContainer);
        });
    }
    
    if (registerLink) {
        registerLink.addEventListener('click', (e) => {
            e.preventDefault();
            showForm(registerFormContainer, loginFormContainer);
        });
    }

    // Setup logout button
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            // Clear token and redirect to login page
            localStorage.removeItem('token');
            window.location.href = '/';
        });
    }

    // Инициализация вкладок и библиотеки на странице профиля
    setupTabs();
    setupLibrary();
});

// Fetch user data for profile page
async function fetchUserData(token) {
    try {
        const response = await fetch(API.me, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            const userData = await response.json();
            const welcomeElement = document.getElementById('welcome-message');
            if (welcomeElement) {
                welcomeElement.textContent = `Добро пожаловать, ${userData.username}!`;
            }
        } else {
            // Token is invalid, redirect to login
            localStorage.removeItem('token');
            window.location.href = '/';
        }
    } catch (error) {
        console.error('Failed to fetch user data:', error);
    }
}

// Show login or register form
function showForm(showForm, hideForm) {
    showForm.classList.remove('hidden');
    hideForm.classList.add('hidden');
    
    // Clear alerts
    clearAlerts();
}

// Show alert message
function showAlert(alertElement, message, type) {
    if (alertElement) {
        alertElement.textContent = message;
        alertElement.className = `alert alert-${type}`;
        alertElement.classList.remove('hidden');
    }
}

// Clear all alerts
function clearAlerts() {
    const alerts = document.querySelectorAll('.alert');
    alerts.forEach(alert => {
        alert.textContent = '';
        alert.className = 'alert hidden';
    });
}

// Функции для работы с вкладками
function setupTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    
    if (!tabs.length) return;
    
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.target;
            
            // Деактивируем все вкладки и контент
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            
            // Активируем выбранную вкладку и контент
            tab.classList.add('active');
            document.getElementById(target).classList.add('active');
        });
    });
}

// Функции для работы с PDF библиотекой
function setupLibrary() {
    const fileInput = document.getElementById('pdf-file');
    const fileNameDisplay = document.getElementById('file-name');
    const uploadForm = document.getElementById('upload-form');
    const progressBarContainer = document.getElementById('upload-progress');
    const progressBar = progressBarContainer ? progressBarContainer.querySelector('.progress-bar') : null;
    const uploadAlert = document.getElementById('upload-alert');
    const filesTable = document.getElementById('files-table');
    const filesEmpty = document.getElementById('no-files-message');
    const filesLoading = document.getElementById('files-loading');
    
    if (!fileInput || !uploadForm) return;
    
    // Обновление имени выбранного файла
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            fileNameDisplay.textContent = e.target.files[0].name;
        } else {
            fileNameDisplay.textContent = 'Файл не выбран';
        }
    });
    
    // Загрузка файла
    uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        console.log('Form submitted');
        
        if (!fileInput.files.length) {
            showAlert(uploadAlert, 'error', 'Пожалуйста, выберите файл для загрузки');
            return;
        }
        
        const file = fileInput.files[0];
        console.log('Selected file:', file.name, file.type, file.size);
        
        // Проверка на PDF
        if (!file.type.includes('pdf')) {
            showAlert(uploadAlert, 'error', 'Можно загружать только PDF файлы');
            return;
        }
        
        // Проверка размера файла (макс. 10 МБ)
        if (file.size > 10 * 1024 * 1024) {
            showAlert(uploadAlert, 'error', 'Максимальный размер файла - 10 МБ');
            return;
        }
        
        const formData = new FormData();
        formData.append('file', file);
        
        try {
            // Отображаем прогресс
            if (progressBar) {
                progressBar.style.width = '0%';
                progressBarContainer.style.display = 'block';
                progressBarContainer.classList.remove('hidden');
            }
            
            console.log('Sending upload request...');
            
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/files/upload');
            
            // Добавляем токен авторизации
            const token = localStorage.getItem('token');
            console.log('Token:', token ? 'Present' : 'Missing');
            
            if (token) {
                xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            }
            
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable && progressBar) {
                    const percent = (e.loaded / e.total) * 100;
                    progressBar.style.width = percent + '%';
                    console.log(`Upload progress: ${percent.toFixed(2)}%`);
                }
            });
            
            xhr.onload = function() {
                console.log('XHR completed with status:', xhr.status, xhr.statusText);
                console.log('Response:', xhr.responseText);
                
                if (progressBarContainer) {
                    progressBarContainer.style.display = 'none';
                    progressBarContainer.classList.add('hidden');
                }
                
                if (xhr.status === 200 || xhr.status === 201) {
                    showAlert(uploadAlert, 'success', 'Файл успешно загружен');
                    fileInput.value = '';
                    fileNameDisplay.textContent = 'Файл не выбран';
                    
                    // Обновляем список файлов
                    loadUserFiles();
                } else {
                    try {
                        const response = JSON.parse(xhr.responseText);
                        showAlert(uploadAlert, 'error', response.detail || 'Ошибка при загрузке файла');
                    } catch (e) {
                        showAlert(uploadAlert, 'error', 'Ошибка при загрузке файла');
                    }
                }
            };
            
            xhr.onerror = function() {
                console.error('XHR error occurred');
                
                if (progressBarContainer) {
                    progressBarContainer.style.display = 'none';
                    progressBarContainer.classList.add('hidden');
                }
                showAlert(uploadAlert, 'error', 'Ошибка при загрузке файла');
            };
            
            xhr.send(formData);
        } catch (error) {
            console.error('Error in submit handler:', error);
            
            if (progressBarContainer) {
                progressBarContainer.style.display = 'none';
                progressBarContainer.classList.add('hidden');
            }
            showAlert(uploadAlert, 'error', 'Ошибка при загрузке файла');
        }
    });
    
    // Загрузка списка файлов пользователя
    loadUserFiles();
}

// Загрузка списка файлов пользователя
async function loadUserFiles() {
    const filesList = document.getElementById('files-list');
    const filesTable = document.getElementById('files-table');
    const filesLoading = document.getElementById('files-loading');
    const filesEmpty = document.getElementById('no-files-message');
    
    if (!filesList) return;
    
    try {
        if (filesTable) {
            filesTable.style.display = 'none';
            filesTable.classList.add('hidden');
        }
        if (filesEmpty) {
            filesEmpty.style.display = 'none';
            filesEmpty.classList.add('hidden');
        }
        if (filesLoading) {
            filesLoading.style.display = 'block';
            filesLoading.classList.remove('hidden');
        }
        
        const token = localStorage.getItem('token');
        const response = await fetch('/api/files', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (filesLoading) {
            filesLoading.style.display = 'none';
            filesLoading.classList.add('hidden');
        }
        
        if (!response.ok) {
            throw new Error('Ошибка при загрузке файлов');
        }
        
        const files = await response.json();
        
        if (files.length === 0) {
            if (filesEmpty) {
                filesEmpty.style.display = 'block';
                filesEmpty.classList.remove('hidden');
            }
            return;
        }
        
        if (filesTable) {
            filesTable.style.display = 'table';
            filesTable.classList.remove('hidden');
        }
        
        const tbody = filesList;
        tbody.innerHTML = '';
        
        files.forEach(file => {
            const tr = document.createElement('tr');
            
            // Форматируем размер файла
            const fileSize = formatFileSize(file.file_size);
            
            // Форматируем дату загрузки
            const uploadDate = new Date(file.upload_date).toLocaleDateString();
            
            // Создаем URL для просмотра PDF с параметрами
            const viewerUrl = `/view?file=${file.filename}&name=${encodeURIComponent(file.original_filename)}`;
            
            tr.innerHTML = `
                <td>
                    <a href="${viewerUrl}" class="file-link">
                        ${file.original_filename}
                    </a>
                </td>
                <td><span class="file-size">${fileSize}</span></td>
                <td>${uploadDate}</td>
                <td class="file-actions">
                    <a href="${viewerUrl}" class="file-action-btn" title="Просмотреть PDF">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                        Просмотреть
                    </a>
                    <a href="/uploads/${file.filename}" class="file-action-btn" download="${file.original_filename}" title="Скачать PDF">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                        Скачать
                    </a>
                    <button class="file-action-btn delete" data-id="${file.id}" title="Удалить PDF">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                        Удалить
                    </button>
                </td>
            `;
            
            tbody.appendChild(tr);
        });
        
        // Добавляем обработчики для кнопок удаления
        const deleteButtons = tbody.querySelectorAll('.file-action-btn.delete');
        deleteButtons.forEach(button => {
            button.addEventListener('click', () => {
                const fileId = button.dataset.id;
                deleteFile(fileId);
            });
        });
    } catch (error) {
        if (filesLoading) {
            filesLoading.style.display = 'none';
            filesLoading.classList.add('hidden');
        }
        console.error('Ошибка при загрузке файлов:', error);
    }
}

// Удаление файла
async function deleteFile(fileId) {
    if (!confirm('Вы уверены, что хотите удалить этот файл?')) {
        return;
    }
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`/api/files/${fileId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            throw new Error('Ошибка при удалении файла');
        }
        
        // Обновляем список файлов
        loadUserFiles();
    } catch (error) {
        console.error('Ошибка при удалении файла:', error);
        alert('Не удалось удалить файл. Пожалуйста, попробуйте снова.');
    }
}

// Форматирование размера файла
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Байт';
    
    const k = 1024;
    const sizes = ['Байт', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Загрузка словаря пользователя
async function loadUserDictionary() {
    const dictionaryList = document.getElementById('dictionary-list');
    if (!dictionaryList) return;
    
    try {
        dictionaryList.innerHTML = '<tr><td colspan="4" class="text-center"><div class="spinner"></div><p>Загрузка словаря...</p></td></tr>';
        
        const token = localStorage.getItem('token');
        if (!token) {
            console.error('Отсутствует токен авторизации');
            dictionaryList.innerHTML = '<tr><td colspan="4" class="text-center text-danger">Ошибка авторизации. Пожалуйста, войдите снова.</td></tr>';
            return;
        }
        
        const response = await fetch('/api/dictionary', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        // Сначала получаем текст ответа для логирования
        const responseText = await response.text();
        console.log('Ответ от API словаря:', response.status, responseText);
        
        if (!response.ok) {
            throw new Error(`Ошибка при загрузке словаря: ${response.status} - ${responseText}`);
        }
        
        // Пробуем распарсить JSON
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (jsonError) {
            console.error('Ошибка при парсинге JSON словаря:', jsonError);
            throw new Error(`Невозможно разобрать ответ сервера: ${jsonError.message}`);
        }
        
        if (!data.words) {
            throw new Error('Неверный формат ответа от сервера: отсутствует поле words');
        }
        
        console.log('Получены данные словаря:', data);
        
        if (data.words.length === 0) {
            dictionaryList.innerHTML = '<tr><td colspan="4" class="text-center">В вашем словаре пока нет слов</td></tr>';
            return;
        }
        
        dictionaryList.innerHTML = '';
        
        data.words.forEach(item => {
            // Проверяем все поля прежде чем использовать
            if (!item || typeof item !== 'object') {
                console.warn('Некорректный элемент словаря:', item);
                return;
            }
            
            const tr = document.createElement('tr');
            
            // Форматируем дату добавления, безопасно обрабатывая возможные ошибки
            let addDate = 'Нет даты';
            try {
                if (item.created_at) {
                    addDate = new Date(item.created_at).toLocaleDateString();
                }
            } catch (dateError) {
                console.warn('Ошибка при форматировании даты:', dateError);
            }
            
            tr.innerHTML = `
                <td>${item.word || ''}</td>
                <td>${item.translation || ''}</td>
                <td>${addDate}</td>
                <td class="word-actions">
                    <button class="btn btn-sm btn-outline-danger delete-word" data-id="${item.id}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                        Удалить
                    </button>
                </td>
            `;
            
            dictionaryList.appendChild(tr);
        });
        
        // Добавляем обработчики для кнопок удаления
        const deleteButtons = dictionaryList.querySelectorAll('.delete-word');
        deleteButtons.forEach(button => {
            button.addEventListener('click', () => {
                const wordId = button.dataset.id;
                deleteWordFromDictionary(wordId);
            });
        });
    } catch (error) {
        console.error('Ошибка при загрузке словаря:', error);
        dictionaryList.innerHTML = `<tr><td colspan="4" class="text-center text-danger">Произошла ошибка при загрузке словаря: ${error.message}</td></tr>`;
    }
}

// Удаление слова из словаря
async function deleteWordFromDictionary(wordId) {
    if (!confirm('Вы уверены, что хотите удалить это слово из словаря?')) {
        return;
    }
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`/api/dictionary/${wordId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            throw new Error('Ошибка при удалении слова');
        }
        
        // Обновляем список слов
        loadUserDictionary();
    } catch (error) {
        console.error('Ошибка при удалении слова:', error);
        alert('Произошла ошибка при удалении слова из словаря');
    }
}

// Инициализация загрузки словаря при клике на вкладку
function initDictionaryTab() {
    const dictionaryTab = document.querySelector('.tab-btn[data-target="tab-dictionary"]');
    if (dictionaryTab) {
        dictionaryTab.addEventListener('click', loadUserDictionary);
        
        // Загружаем словарь, если сейчас активна вкладка словаря
        if (dictionaryTab.classList.contains('active')) {
            loadUserDictionary();
        }
    }
}

// Добавляем инициализацию вкладки словаря после загрузки страницы
document.addEventListener('DOMContentLoaded', function() {
    // Существующие инициализации
    setupTabs();
    setupLibrary();
    
    // Инициализация словаря
    initDictionaryTab();
}); 