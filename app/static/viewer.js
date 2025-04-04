// PDF.js глобальные переменные
const pdfjsLib = window['pdfjs-dist/build/pdf'];

// Исправляем путь к PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Проверяем загрузку библиотеки
console.log('PDF.js загружен:', !!pdfjsLib);

// Настройки просмотрщика
let pdfDoc = null;
let pageNum = 1;
let pageRendering = false;
let pageNumPending = null;
let scale = 1.0;
let canvas = null;
let ctx = null;

// Глобальные переменные для работы с переводом
let currentPageText = "";
let currentPageTextItems = [];
let lastTranslation = "";
let translationPanel = null;
let translationContent = null;
let selectedTextPosition = { left: 0, centerX: 0 };
let translationAnimationFrame = null;
let translationTextWidth = 0;
let panelWidth = 0;
let contextCache = new Map();
let isAutoScrolling = false;
let scrollSpeed = 1; // пикселей в кадр
let scrollDirection = -1; // -1 влево, 1 вправо
let scrollPause = 0; // пауза при достижении края

// Получение PDF URL из параметров
function getPdfUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    const fileId = urlParams.get('file');
    
    if (!fileId) {
        showError('Не указан файл для просмотра');
        return null;
    }
    
    const fileUrl = `/uploads/${fileId}`;
    
    // Установить ссылку для скачивания
    const downloadBtn = document.getElementById('download-btn');
    if (downloadBtn) {
        downloadBtn.href = fileUrl;
        
        // Также получить оригинальное имя файла (если есть)
        const fileName = urlParams.get('name');
        if (fileName) {
            downloadBtn.setAttribute('download', fileName);
        }
    }
    
    return fileUrl;
}

// Отображение ошибки
function showError(message) {
    const viewerElement = document.getElementById('pdf-viewer');
    const loadingElement = document.getElementById('pdf-loading');
    
    if (loadingElement) {
        loadingElement.style.display = 'none';
    }
    
    if (viewerElement) {
        viewerElement.innerHTML = `
            <div class="error-message">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12" y2="16"></line></svg>
                <h3>Ошибка при загрузке PDF</h3>
                <p>${message}</p>
            </div>
        `;
    }
}

// Рендеринг страницы PDF
function renderPage(num) {
    pageRendering = true;
    
    // Обновить текущий номер страницы
    document.getElementById('page-num').textContent = num;
    
    // Получить страницу
    pdfDoc.getPage(num).then(function(page) {
        const viewport = page.getViewport({ scale: scale });
        
        // Создать canvas для страницы, если его еще нет
        if (!canvas) {
            canvas = document.createElement('canvas');
            ctx = canvas.getContext('2d');
            document.getElementById('pdf-viewer').appendChild(canvas);
            
            // Добавляем обработчик клика на канвас
            canvas.addEventListener('click', handleCanvasClick);
        }
        
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        // Рендеринг PDF страницы в canvas
        const renderContext = {
            canvasContext: ctx,
            viewport: viewport
        };
        
        const renderTask = page.render(renderContext);
        
        // Получаем текст страницы для дальнейшей обработки кликов
        getPageText(page, viewport);
        
        // Подождать окончания рендеринга
        renderTask.promise.then(function() {
            pageRendering = false;
            
            // Скрыть индикатор загрузки
            document.getElementById('pdf-loading').style.display = 'none';
            
            // Если есть отложенный рендеринг страницы, выполнить его
            if (pageNumPending !== null) {
                renderPage(pageNumPending);
                pageNumPending = null;
            }
        });
    }).catch(function(error) {
        console.error('Ошибка при рендеринге страницы:', error);
        showError('Невозможно отобразить страницу PDF');
    });
}

// Получение текста страницы для обработки кликов
async function getPageText(page, viewport) {
    try {
        console.log('Получение текста страницы...');
        const textContent = await page.getTextContent();
        console.log('Текст страницы получен:', textContent.items.length, 'элементов');
        
        // Сохраняем текстовые элементы с их позициями и очищаем от шаблонных тегов
        currentPageTextItems = textContent.items.map(item => {
            // Очищаем текст от шаблонных тегов
            const cleanedText = cleanJinjaTags(item.str);
            
            // Преобразуем координаты текста в координаты canvas
            const tx = pdfjsLib.Util.transform(
                viewport.transform,
                [1, 0, 0, 1, item.transform[4], item.transform[5]]
            );
            
            return {
                text: cleanedText, // Используем очищенный текст
                x: tx[4],
                y: tx[5],
                width: item.width * viewport.scale,
                height: item.height * viewport.scale,
                transform: item.transform
            };
        });
        
        // Объединяем весь текст страницы для перевода (уже очищенный от тегов)
        currentPageText = currentPageTextItems.map(item => item.text).join(' ');
        console.log('Общий текст страницы:', currentPageText.substring(0, 100) + '...');
        
        // Получаем полный перевод текста страницы для бегущей строки
        if (currentPageText.trim()) {
            // Переводим весь текст страницы
            translateFullPageText(currentPageText);
        } else {
            console.log('Текст страницы пуст, перевод не выполняется');
            updateTranslation('Не удалось извлечь текст из PDF. Попробуйте другой документ.');
        }
    } catch (error) {
        console.error('Ошибка при получении текста страницы:', error);
        updateTranslation('Ошибка при извлечении текста: ' + error.message);
    }
}

// Очистка текста от шаблонных тегов Jinja2
function cleanJinjaTags(text) {
    if (!text) return text;
    
    // Убедимся, что обрабатываем строку
    if (typeof text !== 'string') {
        return text;
    }
    
    // Удаляем различные варианты тегов Jinja2
    let cleaned = text;
    
    // Удаляем конструкции вида [{% ... %}] (с квадратными скобками)
    cleaned = cleaned.replace(/\[\{%.*?%\}\]/g, '');
    
    // Удаляем теги {% if has_mapping %} и {% endif %}
    cleaned = cleaned.replace(/\{%\s*if\s+has_mapping\s*%\}/g, '');
    cleaned = cleaned.replace(/\{%\s*endif\s*%\}/g, '');
    
    // Удаляем конструкции вида {{%...%}} (двойные фигурные скобки)
    cleaned = cleaned.replace(/\{\{%.*?%\}\}/g, '');
    
    // Удаляем любые конструкции вида {% ... %}
    cleaned = cleaned.replace(/\{%.*?%\}/g, '');
    
    // Удаляем любые конструкции вида {{ ... }}
    cleaned = cleaned.replace(/\{\{.*?\}\}/g, '');
    
    // Удаляем конструкции вида [% ... %] и [{{ ... }}]
    cleaned = cleaned.replace(/\[%.*?%\]/g, '');
    cleaned = cleaned.replace(/\[\{\{.*?\}\}\]/g, '');
    
    // Удаляем специфические строки
    const specificStrings = [
        '{{% if has_mapping %}}', 
        '{{% endif %}}',
        '{% if has_mapping %}',
        '{% endif %}',
        '{{ endif }}',
        '{{ if has_mapping }}',
        '[% endif %]',
        '[% if has_mapping %]',
        '[{{ endif }}]',
        '[{{ if has_mapping }}]',
        '{{% endif %',
        '{{% if',
        '%}}'
    ];
    
    for (const str of specificStrings) {
        cleaned = cleaned.replace(new RegExp(escapeRegExp(str), 'g'), '');
    }
    
    return cleaned.trim();
}

// Функция для обработки токена авторизации
function getAuthToken() {
    // Получаем токен из localStorage
    let token = localStorage.getItem('token');
    
    // Если токен отсутствует, пытаемся получить его из cookie
    if (!token) {
        token = getCookie('token');
        // Если нашли токен в cookie, сохраняем его в localStorage для будущих запросов
        if (token) {
            console.log('Токен найден в cookie, сохраняем в localStorage');
            localStorage.setItem('token', token);
        } else {
            console.error('Токен не найден ни в localStorage, ни в cookie');
            // Перенаправляем на страницу входа
            window.location.href = '/';
            return null;
        }
    }
    
    // Проверяем токен на валидность (не пустой и не undefined)
    if (!token || token === 'undefined' || token === 'null') {
        console.error('Токен невалиден:', token);
        // Удаляем невалидный токен
        localStorage.removeItem('token');
        // Перенаправляем на страницу входа
        window.location.href = '/';
        return null;
    }
    
    return token;
}

// Получение cookie по имени
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

// Перевод полного текста страницы
async function translateFullPageText(text) {
    try {
        // Получаем элемент для отображения полного перевода
        const fullTranslationContent = document.getElementById("fullTranslationContent");
        if (!fullTranslationContent) {
            console.error("Элемент для полного перевода не найден");
            return;
        }
        
        // Очищаем текст от шаблонных тегов
        const cleanedText = cleanJinjaTags(text);
        
        // Показываем индикатор загрузки, пока идет перевод
        fullTranslationContent.innerHTML = '<div class="loading-translation">Переводим страницу...</div>';
        
        // Проверяем, есть ли текст уже в кеше
        if (contextCache.has(cleanedText)) {
            console.log('Перевод найден в кеше');
            lastTranslation = contextCache.get(cleanedText);
            fullTranslationContent.textContent = lastTranslation;
            return;
        }
        
        // Получаем токен авторизации
        const token = getAuthToken();
        if (!token) {
            throw new Error('Отсутствует токен авторизации. Пожалуйста, войдите в систему заново.');
        }
        
        console.log('Отправка запроса на перевод полного текста...');
        const response = await fetch('/api/translate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                text: cleanedText,
                source_lang: 'en',
                target_lang: 'ru'
            })
        });
        
        if (!response.ok) {
            if (response.status === 401) {
                // Если токен устарел, перенаправляем на страницу входа
                console.error('Токен устарел, перенаправление на страницу входа');
                localStorage.removeItem('token'); // Удаляем недействительный токен
                window.location.href = '/'; // Перенаправляем на главную страницу
                return;
            }
            throw new Error(`Ошибка перевода: ${response.status}`);
        }
        
        const data = await response.json();
        lastTranslation = data.translated_text;
        
        // Кешируем перевод
        contextCache.set(cleanedText, lastTranslation);
        
        console.log('Получен перевод полного текста:', lastTranslation.substring(0, 100) + '...');
        
        // Обновляем строку с переведенным текстом
        fullTranslationContent.textContent = lastTranslation;
        fullTranslationContent.style.transform = 'translateX(0px)';
    } catch (error) {
        console.error('Ошибка при переводе полного текста:', error);
        const fullTranslationContent = document.getElementById("fullTranslationContent");
        if (fullTranslationContent) {
            fullTranslationContent.innerHTML = `<div class="translation-error">Ошибка перевода страницы: ${error.message}</div>`;
        }
    }
}

// Обработка клика на канвас
function handleCanvasClick(event) {
    // Получаем координаты клика относительно канваса
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    console.log('Клик по канвасу:', x, y);
    
    // Ищем текстовый элемент, на который кликнули
    const clickedItem = findTextItemAtPosition(x, y);
    
    if (clickedItem) {
        console.log('Найден текстовый элемент:', clickedItem.text);
        
        // Выделяем слово в тексте
        const clickedWord = getWordAtPosition(clickedItem, x);
        
        if (clickedWord) {
            console.log('Найдено слово при клике:', clickedWord.word);
            
            // Проверяем, что слово непустое и содержит буквы или цифры
            if (clickedWord.word && /[a-zA-Z0-9]/.test(clickedWord.word)) {
                // Находим позицию слова в полном тексте
                const wordPosition = findWordPositionInFullText(clickedWord.word);
                
                if (wordPosition !== -1) {
                    console.log('Позиция слова в тексте:', wordPosition);
                    
                    // Центрируем бегущую строку на соответствующей позиции в переводе
                    centerTranslationOnWordPosition(clickedWord.word, wordPosition);
                } else {
                    console.log('Слово не найдено в полном тексте, переводим отдельно');
                    // Если слово не найдено в тексте, просто переводим его и отображаем
                    translateWordInContext(clickedWord.word, currentPageText, pageNum, null);
                }
            } else {
                console.log('Пустое слово или не содержит букв/цифр, игнорируем');
            }
        } else {
            console.log('Не удалось определить слово при клике');
        }
    } else {
        console.log('Текстовый элемент не найден по координатам клика');
    }
}

// Поиск текстового элемента по координатам
function findTextItemAtPosition(x, y) {
    // Добавляем немного пространства для удобства клика
    const padding = 10; // Увеличиваем зону клика
    
    console.log('Поиск текстового элемента, количество элементов:', currentPageTextItems.length);
    
    // Перебираем все текстовые элементы на странице
    for (const item of currentPageTextItems) {
        const isHit = (
            x >= item.x - padding &&
            x <= item.x + item.width + padding &&
            y >= item.y - item.height - padding &&
            y <= item.y + padding
        );
        
        if (isHit) {
            console.log('Найден текстовый элемент:', item.text, 'по координатам:', item.x, item.y);
            return item;
        }
    }
    
    console.log('Текстовый элемент не найден');
    return null;
}

// Получение слова в позиции клика
function getWordAtPosition(textItem, x) {
    // Очищаем текст от шаблонных тегов (если это ещё не сделано)
    const text = cleanJinjaTags(textItem.text);
    
    if (!text || text.trim() === '') {
        console.log('Пустой текст в элементе');
        return null;
    }
    
    console.log('Определение слова в тексте:', text);
    
    // Простая логика для оценки ширины символов
    const avgCharWidth = textItem.width / text.length;
    
    // Оценка позиции символа, на который кликнули
    const relativeX = x - textItem.x;
    const charIndex = Math.floor(relativeX / avgCharWidth);
    
    console.log('Относительная позиция X:', relativeX, 'Индекс символа:', charIndex);
    
    if (charIndex < 0 || charIndex >= text.length) {
        console.log('Клик за пределами текста');
        return null;
    }
    
    // Находим начало и конец слова
    let startIndex = charIndex;
    let endIndex = charIndex;
    
    // Ищем начало слова
    while (startIndex > 0 && /[\w''-]/.test(text[startIndex - 1])) {
        startIndex--;
    }
    
    // Ищем конец слова
    while (endIndex < text.length - 1 && /[\w''-]/.test(text[endIndex + 1])) {
        endIndex++;
    }
    
    // Проверяем, что мы нашли слово
    if (endIndex < startIndex || !/[\w''-]/.test(text[startIndex])) {
        console.log('Не удалось определить слово');
        return null;
    }
    
    const word = text.substring(startIndex, endIndex + 1);
    
    // Дополнительная проверка на пустое слово
    if (!word || word.trim() === '') {
        console.log('Получено пустое слово');
        return null;
    }
    
    // Очищаем слово от знаков пунктуации по краям
    const cleanWord = word.replace(/^[^\w]+|[^\w]+$/g, '');
    
    if (!cleanWord || cleanWord.trim() === '') {
        console.log('После очистки получено пустое слово');
        return null;
    }
    
    const left = textItem.x + (startIndex * avgCharWidth);
    const width = (endIndex - startIndex + 1) * avgCharWidth;
    
    console.log('Найдено слово:', cleanWord);
    
    return {
        word: cleanWord,
        left,
        width,
        top: textItem.y - textItem.height,
        height: textItem.height
    };
}

// Поиск позиции слова в полном тексте страницы
function findWordPositionInFullText(word) {
    if (!currentPageText) return -1;
    
    // Ищем точное совпадение слова с учетом границ слова
    const regex = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i');
    const match = regex.exec(currentPageText);
    
    return match ? match.index : -1;
}

// Центрирование бегущей строки на позиции слова в переводе
function centerTranslationOnWordPosition(word, position) {
    // Если перевод еще не готов, или позиция слова не найдена
    if (!lastTranslation || position === -1) {
        translateWord(word);
        return;
    }
    
    // Переводим слово с учетом контекста
    // Используем весь текст страницы как контекст для более точного перевода
    translateWordInContext(word, currentPageText, pageNum, position);
}

// Перевод слова в контексте
async function translateWordInContext(word, context, pageNum, position) {
    try {
        // Очищаем слово и контекст от шаблонных тегов
        const cleanedWord = cleanJinjaTags(word);
        const cleanedContext = cleanJinjaTags(context);
        
        console.log(`Перевод слова "${cleanedWord}" в контексте [стр. ${pageNum}]`);
        
        // Получаем токен авторизации
        const token = getAuthToken();
        if (!token) {
            throw new Error('Отсутствует токен авторизации');
        }
        
        // Пытаемся найти перевод через сопоставление, если оно доступно
        if (typeof findTranslationWithMapping === 'function') {
            try {
                const mappingTranslation = await findTranslationWithMapping(cleanedWord, cleanedContext);
                if (mappingTranslation) {
                    console.log('Найден перевод через сопоставление:', mappingTranslation);
                    showTranslation(mappingTranslation, position);
                    return;
                }
            } catch (mappingError) {
                console.warn('Ошибка при поиске перевода через сопоставление:', mappingError);
                // Продолжаем работу с API перевода
            }
        }
        
        // Если сопоставление не доступно или не найдено, используем API перевода
        const response = await fetch("/api/translate", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({
                text: cleanedWord,
                source_lang: 'en',
                target_lang: 'ru',
                context: cleanedContext
            }),
        });

        if (!response.ok) {
            if (response.status === 401) {
                // Если токен устарел, перенаправляем на страницу входа
                console.error('Токен устарел, перенаправление на страницу входа');
                localStorage.removeItem('token'); // Удаляем недействительный токен
                window.location.href = '/'; // Перенаправляем на главную страницу
                return;
            }
            throw new Error(`Ошибка API: ${response.status}`);
        }

        const data = await response.json();
        console.log("Получены данные перевода:", data);
        
        // Убедимся, что у нас есть текст перевода
        if (!data || (!data.translated_text && !data.translation)) {
            throw new Error('Сервер вернул пустой перевод');
        }
        
        const translatedText = data.translated_text || data.translation;
        
        // Формируем объект для отображения перевода
        const translationData = {
            word: cleanedWord,
            translation: translatedText,
            context: cleanedContext.substring(0, 100) + '...'
        };
        
        console.log("Подготовленные данные для отображения:", translationData);
        showTranslation(translationData, position);
    } catch (error) {
        console.error("Ошибка при переводе:", error);
        // Показываем сообщение об ошибке
        const translationContent = document.getElementById("translationContent");
        if (translationContent) {
            translationContent.innerHTML = `<div class="translation-error">Ошибка при переводе: ${error.message}</div>`;
            const translationPanel = document.getElementById("translationPanel");
            if (translationPanel) {
                translationPanel.style.display = "block";
            }
        }
    }
}

// Функция для подсветки и центрирования слова
function highlightAndCenterWord(word, index) {
    // Применяем подсветку слова в тексте перевода
    setTimeout(() => {
        // Сохраняем оригинальный текст
        const originalContent = translationContent.textContent;
        
        // Создаем HTML с подсветкой
        const prefix = lastTranslation.substring(0, index);
        const matchedWord = lastTranslation.substring(index, index + word.length);
        const suffix = lastTranslation.substring(index + word.length);
        
        // Применяем подсветку, добавляя дополнительные элементы для улучшения видимости
        translationContent.innerHTML = `${prefix}<span class="highlighted-word">${matchedWord}</span>${suffix}`;
        
        // Центрируем на найденном слове
        const highlightedElement = translationContent.querySelector('.highlighted-word');
        if (highlightedElement) {
            const containerRect = translationPanel.getBoundingClientRect();
            const elementRect = highlightedElement.getBoundingClientRect();
            
            // Вычисляем точную позицию для центрирования
            const relativeLeft = elementRect.left - containerRect.left;
            const centerX = relativeLeft + elementRect.width / 2;
            
            console.log('Центрирование на позиции:', centerX);
            
            // Анимированное центрирование
            positionTranslation(centerX);
            
            // Через 3 секунды убираем подсветку, но сохраняем позицию
            setTimeout(() => {
                translationContent.textContent = originalContent;
                // Получаем текущую трансформацию и сохраняем её
                const transformStyle = translationContent.style.transform;
                if (transformStyle) {
                    translationContent.style.transform = transformStyle;
                }
            }, 3000);
        }
    }, 100);
}

// Функция для поиска предложения, содержащего слово
function findSentenceWithWord(word, text) {
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    const wordRegex = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i');
    
    for (const sentence of sentences) {
        if (wordRegex.test(sentence)) {
            return sentence.trim();
        }
    }
    
    return '';
}

// Алгоритм нечеткого поиска для нахождения наилучшего соответствия
function findBestMatch(word, text, originalWord, originalContext) {
    console.log('Поиск совпадения для:', word, 'в контексте. Оригинал:', originalWord);
    
    // Если мы знаем оригинальное слово и контекст, используем более точный алгоритм
    if (originalWord && originalContext) {
        // Находим позицию слова в оригинальном контексте
        const wordRegex = new RegExp(`\\b${escapeRegExp(originalWord)}\\b`, 'i');
        const originalMatch = wordRegex.exec(originalContext);
        
        if (originalMatch) {
            // Вычисляем относительную позицию слова в оригинальном тексте (от 0 до 1)
            const relativePosition = originalMatch.index / originalContext.length;
            console.log('Относительная позиция в оригинале:', relativePosition);
            
            // Находим примерную позицию в переводе на основе относительной позиции
            const approximatePosition = Math.floor(relativePosition * text.length);
            console.log('Примерная позиция в переводе:', approximatePosition);
            
            // Определяем диапазон поиска (например, ±15% от длины текста)
            const searchRangePercent = 0.15; 
            const searchRange = Math.floor(text.length * searchRangePercent);
            const startSearch = Math.max(0, approximatePosition - searchRange);
            const endSearch = Math.min(text.length, approximatePosition + searchRange);
            
            console.log('Диапазон поиска:', startSearch, 'до', endSearch);
            
            // Ищем точное совпадение в ограниченном диапазоне
            const limitedContext = text.substring(startSearch, endSearch);
            const limitedMatch = limitedContext.indexOf(word);
            
            if (limitedMatch >= 0) {
                // Скорректируем индекс относительно начала полного текста
                const exactIndex = startSearch + limitedMatch;
                console.log('Найдено точное совпадение в ограниченном диапазоне:', exactIndex);
                return {
                    matched: true,
                    startIndex: exactIndex,
                    matchedText: word
                };
            }
            
            // Если точного совпадения нет, пробуем нечеткий поиск в том же диапазоне
            const words = limitedContext.split(/\s+/);
            const targetLower = word.toLowerCase();
            
            let bestMatchScore = 0;
            let bestMatchIndex = -1;
            let bestMatchWord = '';
            
            for (let i = 0; i < words.length; i++) {
                const currentWord = words[i].replace(/[.,!?;:"'()]/g, '').toLowerCase();
                
                // Пропускаем слишком короткие слова
                if (currentWord.length < 2) continue;
                
                // Для коротких слов (2-3 буквы) требуем точного совпадения
                if (targetLower.length <= 3) {
                    if (currentWord === targetLower) {
                        bestMatchScore = 100;
                        bestMatchIndex = i;
                        bestMatchWord = words[i];
                        break;
                    }
                    continue;
                }
                
                // Для более длинных слов используем нечеткий поиск
                // Считаем совпадение букв
                let matchScore = 0;
                
                // Если слово начинается с того же корня (первые 3-4 буквы)
                const prefixLength = Math.min(4, targetLower.length);
                if (currentWord.startsWith(targetLower.substring(0, prefixLength))) {
                    matchScore += 10; // Увеличиваем вес совпадения префикса
                }
                
                // Проверяем общие буквы
                for (let j = 0; j < Math.min(currentWord.length, targetLower.length); j++) {
                    if (currentWord[j] === targetLower[j]) {
                        matchScore += 1;
                    }
                }
                
                // Если совпадают больше 70% букв
                if (currentWord.length > 0 && targetLower.length > 0) {
                    const similarityRatio = matchScore / Math.max(currentWord.length, targetLower.length);
                    if (similarityRatio > 0.7) {
                        matchScore += 10;
                    }
                }
                
                if (matchScore > bestMatchScore) {
                    bestMatchScore = matchScore;
                    bestMatchIndex = i;
                    bestMatchWord = words[i];
                }
            }
            
            // Если нашли достаточно хорошее совпадение 
            if (bestMatchScore >= 10) { // Повышаем порог уверенности
                // Найдем позицию слова в ограниченном контексте
                let currentPos = 0;
                for (let i = 0; i < bestMatchIndex; i++) {
                    const wordPos = limitedContext.indexOf(words[i], currentPos);
                    if (wordPos >= 0) {
                        currentPos = wordPos + words[i].length;
                        // Пропускаем пробелы
                        while (currentPos < limitedContext.length && /\s/.test(limitedContext[currentPos])) {
                            currentPos++;
                        }
                    }
                }
                
                // Ищем начало слова в ограниченном контексте
                const wordPos = limitedContext.indexOf(bestMatchWord, currentPos);
                if (wordPos >= 0) {
                    // Скорректируем индекс относительно начала полного текста
                    const finalIndex = startSearch + wordPos;
                    console.log('Найдено нечеткое совпадение в ограниченном диапазоне:', finalIndex);
                    return {
                        matched: true,
                        startIndex: finalIndex,
                        matchedText: bestMatchWord
                    };
                }
            }
        }
        
        // Альтернативный подход - по разделу на предложения
        // Разбиваем на предложения, находим в каком предложении слово и ищем в соответствующем переведенном
        const originalSentences = originalContext.split(/[.!?]+/).filter(s => s.trim());
        const translatedSentences = text.split(/[.!?]+/).filter(s => s.trim());
        
        // Ищем предложение с оригинальным словом
        let sentenceIndex = -1;
        for (let i = 0; i < originalSentences.length; i++) {
            if (originalSentences[i].includes(originalWord)) {
                sentenceIndex = i;
                break;
            }
        }
        
        console.log('Найдено в предложении №', sentenceIndex);
        
        // Если нашли предложение и есть соответствующее в переводе
        if (sentenceIndex >= 0 && sentenceIndex < translatedSentences.length) {
            const targetSentence = translatedSentences[sentenceIndex];
            
            // Точное совпадение в нужном предложении
            const exactMatch = targetSentence.indexOf(word);
            if (exactMatch >= 0) {
                // Вычисляем абсолютный индекс в полном тексте
                let absoluteIndex = 0;
                for (let i = 0; i < sentenceIndex; i++) {
                    // Добавляем длину предложения и разделитель
                    const sentenceInFullText = text.indexOf(translatedSentences[i], absoluteIndex);
                    if (sentenceInFullText >= 0) {
                        absoluteIndex = sentenceInFullText + translatedSentences[i].length + 1; // +1 для точки
                    }
                }
                
                // Находим начало предложения в полном тексте
                const sentenceStart = text.indexOf(targetSentence, absoluteIndex);
                if (sentenceStart >= 0) {
                    absoluteIndex = sentenceStart;
                }
                
                // Находим слово в предложении относительно полного текста
                const wordInFullText = text.indexOf(word, absoluteIndex);
                
                if (wordInFullText >= 0) {
                    console.log('Найдено точное совпадение в предложении:', wordInFullText);
                    return {
                        matched: true,
                        startIndex: wordInFullText,
                        matchedText: word
                    };
                }
            }
        }
    }
    
    // Если не сработали продвинутые методы, используем старый алгоритм
    console.log('Используем запасной алгоритм поиска');
    
    // Сначала пробуем точное соответствие во всем тексте
    const exactRegex = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i');
    const exactMatch = exactRegex.exec(text);
    
    if (exactMatch) {
        return {
            matched: true,
            startIndex: exactMatch.index,
            matchedText: exactMatch[0]
        };
    }
    
    // Если точного соответствия нет, разбиваем на слова и ищем похожие
    const words = text.split(/\s+/);
    const targetLower = word.toLowerCase();
    
    // Оцениваем каждое слово
    let bestMatchScore = 0;
    let bestMatchIndex = -1;
    let bestMatchWord = '';
    
    for (let i = 0; i < words.length; i++) {
        const currentWord = words[i].replace(/[.,!?;:"'()]/g, '').toLowerCase();
        
        // Пропускаем слишком короткие слова
        if (currentWord.length < 2) continue;
        
        // Считаем совпадение букв
        let matchScore = 0;
        
        // Если слово начинается с того же корня (первые 3-4 буквы)
        if (currentWord.startsWith(targetLower.substring(0, Math.min(3, targetLower.length)))) {
            matchScore += 5;
        }
        
        // Проверяем общие буквы
        for (let j = 0; j < Math.min(currentWord.length, targetLower.length); j++) {
            if (currentWord[j] === targetLower[j]) {
                matchScore += 1;
            }
        }
        
        // Если совпадают больше 70% букв
        if (currentWord.length > 0 && targetLower.length > 0) {
            const similarityRatio = matchScore / Math.max(currentWord.length, targetLower.length);
            if (similarityRatio > 0.7) {
                matchScore += 10;
            }
        }
        
        if (matchScore > bestMatchScore) {
            bestMatchScore = matchScore;
            bestMatchIndex = i;
            bestMatchWord = words[i];
        }
    }
    
    // Если нашли достаточно хорошее совпадение
    if (bestMatchScore >= 5) {
        // Найдем позицию слова в исходном тексте
        let currentPos = 0;
        for (let i = 0; i < bestMatchIndex; i++) {
            currentPos = text.indexOf(words[i], currentPos) + words[i].length;
            // Пропускаем пробелы
            while (currentPos < text.length && /\s/.test(text[currentPos])) {
                currentPos++;
            }
        }
        
        // Ищем начало слова
        const startIndex = text.indexOf(bestMatchWord, currentPos);
        
        return {
            matched: true,
            startIndex: startIndex,
            matchedText: bestMatchWord
        };
    }
    
    return { matched: false };
}

// Перевод текста
async function translateText(text) {
    try {
        console.log('Начало перевода текста...');
        // Проверяем кеш перевода
        if (contextCache.has(text)) {
            console.log('Перевод найден в кеше');
            lastTranslation = contextCache.get(text);
            updateTranslation(lastTranslation);
            return;
        }
        
        const token = localStorage.getItem('token');
        console.log('Отправка запроса на перевод, длина токена:', token ? token.length : 0);
        
        const response = await fetch('/api/translate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                text: text,
                source_lang: 'en',
                target_lang: 'ru'
            })
        });
        
        console.log('Ответ от сервера перевода:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Ошибка при переводе:', response.status, errorText);
            throw new Error(`Ошибка сервера: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Перевод получен, длина:', data.translated_text.length);
        lastTranslation = data.translated_text;
        
        // Кешируем перевод
        contextCache.set(text, lastTranslation);
        
        // Обновляем отображение перевода
        updateTranslation(lastTranslation);
    } catch (error) {
        console.error('Ошибка при переводе:', error);
        updateTranslation('Ошибка перевода: ' + error.message);
    }
}

// Перевод отдельного слова
async function translateWord(word) {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/translate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                text: word,
                source_lang: 'en',
                target_lang: 'ru'
            })
        });
        
        if (!response.ok) {
            throw new Error('Ошибка при переводе слова');
        }
        
        const data = await response.json();
        const wordTranslation = data.translated_text;
        
        // Помечаем слово в контексте и показываем его перевод
        const context = findAndHighlightWordInContext(word, wordTranslation, lastTranslation);
        updateTranslation(context, true);
    } catch (error) {
        console.error('Ошибка при переводе слова:', error);
    }
}

// Поиск и выделение слова в контексте с добавлением перевода
function findAndHighlightWordInContext(word, wordTranslation, fullText) {
    if (!fullText) return `<span class="highlighted-word">${word}</span> - ${wordTranslation}`;
    
    // Простой поиск по тексту
    const wordLower = word.toLowerCase();
    const fullTextLower = fullText.toLowerCase();
    const index = fullTextLower.indexOf(wordLower);
    
    if (index === -1) {
        return `<span class="highlighted-word">${word}</span> - ${wordTranslation}`;
    }
    
    // Вытаскиваем небольшой контекст вокруг слова
    const contextSize = 100;
    const startIndex = Math.max(0, index - contextSize);
    const endIndex = Math.min(fullText.length, index + word.length + contextSize);
    
    // Формируем HTML с выделенным словом
    const prefix = fullText.substring(startIndex, index);
    const targetWord = fullText.substring(index, index + word.length);
    const suffix = fullText.substring(index + word.length, endIndex);
    
    return `${prefix}<span class="highlighted-word">${targetWord}</span> <span class="translation-highlight">[${wordTranslation}]</span>${suffix}`;
}

// Переход на предыдущую страницу
function onPrevPage() {
    if (pageNum <= 1) {
        return;
    }
    pageNum--;
    queueRenderPage(pageNum);
}

// Переход на следующую страницу
function onNextPage() {
    if (pageNum >= pdfDoc.numPages) {
        return;
    }
    pageNum++;
    queueRenderPage(pageNum);
}

// Постановка рендеринга страницы в очередь
function queueRenderPage(num) {
    if (pageRendering) {
        pageNumPending = num;
    } else {
        renderPage(num);
    }
}

// Изменение масштаба
function onZoomChange(newScale) {
    scale = newScale;
    queueRenderPage(pageNum);
}

// Полноэкранный режим
function toggleFullScreen() {
    const pdfContainer = document.querySelector('.pdf-container');
    
    if (!document.fullscreenElement) {
        if (pdfContainer.requestFullscreen) {
            pdfContainer.requestFullscreen();
        } else if (pdfContainer.mozRequestFullScreen) { // Firefox
            pdfContainer.mozRequestFullScreen();
        } else if (pdfContainer.webkitRequestFullscreen) { // Chrome, Safari и Opera
            pdfContainer.webkitRequestFullscreen();
        } else if (pdfContainer.msRequestFullscreen) { // IE/Edge
            pdfContainer.msRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.mozCancelFullScreen) {
            document.mozCancelFullScreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
    }
}

// Инициализация панели перевода
function initTranslationPanel() {
    const translationPanel = document.getElementById("translationPanel");
    const translationContent = document.getElementById("translationContent");
    
    if (!translationPanel || !translationContent) {
        console.error("Элементы панели перевода не найдены");
        return;
    }
    
    // Добавляем начальный текст и очищаем от шаблонных тегов
    translationContent.textContent = cleanJinjaTags("Нажмите на слово в тексте для перевода");
    
    // Очищаем текст заголовка
    if (translationPanel.previousSibling && translationPanel.previousSibling.nodeType === 3) {
        translationPanel.previousSibling.nodeValue = cleanJinjaTags(translationPanel.previousSibling.nodeValue);
    }
    
    // Отображаем панель сразу при загрузке
    translationPanel.style.display = "block";

    // Переменные для горизонтального перетаскивания текста
    let isDragging = false;
    let startX, startScrollX;
    
    // Обработчик начала перетаскивания
    translationContent.addEventListener("mousedown", function(e) {
        isDragging = true;
        
        // Запоминаем начальные координаты
        startX = e.clientX;
        startScrollX = 0; // Начальное значение смещения
        
        // Получаем текущее смещение, если оно есть
        if (translationContent.style.transform) {
            const match = translationContent.style.transform.match(/translateX\((-?\d+(?:\.\d+)?)px\)/);
            if (match) {
                startScrollX = parseFloat(match[1]);
            }
        }
        
        // Меняем курсор
        translationContent.style.cursor = "grabbing";
        
        // Предотвращаем выделение текста при перетаскивании
        e.preventDefault();
    });
    
    // Обработчик перетаскивания
    document.addEventListener("mousemove", function(e) {
        if (!isDragging) return;
        
        // Вычисляем разницу координат
        const diffX = e.clientX - startX;
        
        // Смещаем содержимое по горизонтали
        translationContent.style.transform = `translateX(${startScrollX + diffX}px)`;
    });
    
    // Обработчик завершения перетаскивания
    document.addEventListener("mouseup", function() {
        if (isDragging) {
            isDragging = false;
            translationContent.style.cursor = "grab";
            
            // Обновляем начальное положение для следующего перетаскивания
            if (translationContent.style.transform) {
                const match = translationContent.style.transform.match(/translateX\((-?\d+(?:\.\d+)?)px\)/);
                if (match) {
                    startScrollX = parseFloat(match[1]);
                }
            }
        }
    });
}

// Запуск автоматического прокручивания
function startAutoScroll() {
    // Отключаем автоматическую прокрутку - строка будет двигаться только при клике
    isAutoScrolling = false;
    
    // Если есть предыдущая анимация, останавливаем её
    if (translationAnimationFrame) {
        cancelAnimationFrame(translationAnimationFrame);
        translationAnimationFrame = null;
    }
}

// Приостановка автоматического прокручивания
function pauseAutoScroll() {
    isAutoScrolling = false;
    
    if (translationAnimationFrame) {
        cancelAnimationFrame(translationAnimationFrame);
        translationAnimationFrame = null;
    }
}

// Возобновление автоматического прокручивания
function resumeAutoScroll() {
    // Больше не запускаем автоматическую прокрутку
    // startAutoScroll();
}

// Вспомогательная функция для экранирования спецсимволов в регулярных выражениях
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Обновление элемента с переводом
function updateTranslation(text, isHtml = false) {
    if (!translationContent) return;
    
    // Останавливаем анимацию
    pauseAutoScroll();
    
    if (isHtml) {
        translationContent.innerHTML = text;
    } else {
        translationContent.textContent = text;
    }
    
    // Проверяем наличие ошибок
    if (text.includes('Ошибка перевода') || text.includes('translation-error')) {
        translationContent.classList.add('translation-error-content');
    } else {
        translationContent.classList.remove('translation-error-content');
    }
    
    // Показываем панель перевода
    translationPanel.style.display = 'block';
    
    // Измеряем ширину текста
    translationTextWidth = translationContent.scrollWidth;
    
    // Если перевод не содержит HTML (не центрирование на слове),
    // то центрируем перевод в начале текста
    if (!isHtml) {
        translationContent.style.transform = 'translateX(0px)';
    }
}

// Инициализация при загрузке документа
document.addEventListener('DOMContentLoaded', function() {
    // Получаем токен и проверяем авторизацию сразу
    const token = getAuthToken();
    if (!token) {
        console.error('Отсутствует токен авторизации, перенаправление на страницу входа');
        window.location.href = '/';
        return;
    }
    
    initPDFViewer();
    initTranslationPanel();
    initFullTranslationPanel();
    
    // Добавляем обработчик клика по документу для перевода слов
    document.addEventListener('click', handleTextClick);
    
    // Также добавляем обработчик для текстового слоя PDF.js
    document.addEventListener('mouseup', function(e) {
        // Проверяем, что клик был внутри PDF-viewer
        const pdfViewer = document.getElementById('pdf-viewer');
        if (pdfViewer && pdfViewer.contains(e.target)) {
            console.log('Клик внутри PDF-viewer обнаружен');
            
            // Проверяем, что клик был по текстовому слою
            const textLayer = closestByClass(e.target, 'textLayer');
            if (textLayer) {
                console.log('Клик в текстовом слое обнаружен');
                handleTextLayerClick(e);
            }
        }
    });
    
    // Очищаем все текстовые узлы страницы от шаблонных тегов
    cleanAllTextNodes(document.body);
    
    console.log('Инициализация завершена');
});

// Функция для очистки всех текстовых узлов от шаблонных тегов
function cleanAllTextNodes(node) {
    // Если это текстовый узел
    if (node.nodeType === 3) { // 3 - это TEXT_NODE
        if (node.nodeValue && node.nodeValue.trim() !== '') {
            const cleanedText = cleanJinjaTags(node.nodeValue);
            if (node.nodeValue !== cleanedText) {
                node.nodeValue = cleanedText;
            }
        }
    } else if (node.nodeType === 1) { // 1 - это ELEMENT_NODE
        // Проверяем, не является ли элемент скриптом или стилем
        const tagName = node.tagName.toLowerCase();
        if (tagName !== 'script' && tagName !== 'style') {
            // Обрабатываем все дочерние узлы
            for (let i = 0; i < node.childNodes.length; i++) {
                cleanAllTextNodes(node.childNodes[i]);
            }
        }
    }
}

// Инициализация панели с полным переводом страницы
function initFullTranslationPanel() {
    const fullTranslationPanel = document.getElementById("fullTranslationPanel");
    const fullTranslationContent = document.getElementById("fullTranslationContent");
    
    if (!fullTranslationPanel || !fullTranslationContent) {
        console.error("Элементы панели полного перевода не найдены");
        return;
    }
    
    // Добавляем начальный текст и очищаем от шаблонных тегов
    fullTranslationContent.textContent = cleanJinjaTags("Загрузка перевода страницы...");
    
    // Очищаем текст заголовка
    if (fullTranslationPanel.previousSibling && fullTranslationPanel.previousSibling.nodeType === 3) {
        fullTranslationPanel.previousSibling.nodeValue = cleanJinjaTags(fullTranslationPanel.previousSibling.nodeValue);
    }
    
    // Переменные для горизонтального перетаскивания текста
    let isDragging = false;
    let startX, startScrollX;
    
    // Обработчик начала перетаскивания
    fullTranslationContent.addEventListener("mousedown", function(e) {
        isDragging = true;
        
        // Запоминаем начальные координаты
        startX = e.clientX;
        startScrollX = 0; // Начальное значение смещения
        
        // Получаем текущее смещение, если оно есть
        if (fullTranslationContent.style.transform) {
            const match = fullTranslationContent.style.transform.match(/translateX\((-?\d+(?:\.\d+)?)px\)/);
            if (match) {
                startScrollX = parseFloat(match[1]);
            }
        }
        
        // Меняем курсор
        fullTranslationContent.style.cursor = "grabbing";
        
        // Предотвращаем выделение текста при перетаскивании
        e.preventDefault();
    });
    
    // Обработчик перетаскивания
    document.addEventListener("mousemove", function(e) {
        if (!isDragging) return;
        
        // Вычисляем разницу координат
        const diffX = e.clientX - startX;
        
        // Смещаем содержимое по горизонтали
        fullTranslationContent.style.transform = `translateX(${startScrollX + diffX}px)`;
    });
    
    // Обработчик завершения перетаскивания
    document.addEventListener("mouseup", function() {
        if (isDragging) {
            isDragging = false;
            fullTranslationContent.style.cursor = "grab";
        }
    });
}

// Позиционирование бегущей строки относительно кликнутого слова
function positionTranslation(centerX) {
    if (!translationContent || !translationPanel) return;
    
    console.log('Positioning at centerX:', centerX);
    
    // Обновляем ширину панели и текста для точных расчетов
    panelWidth = translationPanel.offsetWidth;
    translationTextWidth = translationContent.scrollWidth;
    
    // Обновляем позицию выбранного слова
    selectedTextPosition.centerX = centerX;
    
    // Вычисляем позицию для центрирования перевода
    // Смещаем текст так, чтобы выбранное слово было в центре панели
    const panelCenterX = panelWidth / 2;
    let translateX = panelCenterX - centerX;
    
    // Проверяем, чтобы перевод не выходил за пределы экрана
    const maxTranslateX = Math.min(0, panelWidth - translationTextWidth);
    const minTranslateX = 0;
    
    if (translationTextWidth > panelWidth) {
        // Если текст шире панели, ограничиваем сдвиг
        translateX = Math.min(translateX, minTranslateX);
        translateX = Math.max(translateX, maxTranslateX);
    } else {
        // Если текст уже панели, центрируем его
        translateX = (panelWidth - translationTextWidth) / 2;
    }
    
    console.log('Final translateX:', translateX);
    
    // Плавно перемещаем текст перевода
    translationContent.style.transform = `translateX(${translateX}px)`;
}

// Функция для прокрутки перевода влево
function scrollTranslationLeft() {
    if (!translationContent) return;
    
    // Получаем текущую позицию
    const transformStyle = translationContent.style.transform;
    let currentX = 0;
    if (transformStyle) {
        const match = transformStyle.match(/translateX\((.+)px\)/);
        if (match && match[1]) {
            currentX = parseFloat(match[1]);
        }
    }
    
    // Прокручиваем вправо (смещение влево уменьшается)
    const newX = Math.min(0, currentX + 100);
    
    // Применяем новую позицию с анимацией
    translationContent.style.transform = `translateX(${newX}px)`;
}

// Функция для прокрутки перевода вправо
function scrollTranslationRight() {
    if (!translationContent || !translationPanel) return;
    
    // Получаем текущую позицию
    const transformStyle = translationContent.style.transform;
    let currentX = 0;
    if (transformStyle) {
        const match = transformStyle.match(/translateX\((.+)px\)/);
        if (match && match[1]) {
            currentX = parseFloat(match[1]);
        }
    }
    
    // Обновляем ширину панели и текста для точных расчетов
    panelWidth = translationPanel.offsetWidth;
    translationTextWidth = translationContent.scrollWidth;
    
    // Рассчитываем максимальное смещение влево
    const maxOffset = Math.max(panelWidth - translationTextWidth, 0);
    
    // Прокручиваем влево (смещение влево увеличивается)
    const newX = Math.max(maxOffset, currentX - 100);
    
    // Применяем новую позицию с анимацией
    translationContent.style.transform = `translateX(${newX}px)`;
}

// Функция для большой прокрутки вперед (быстрый просмотр перевода)
function scrollTranslationForward() {
    if (!translationContent || !translationPanel) return;
    
    // Получаем текущую позицию
    const transformStyle = translationContent.style.transform;
    let currentX = 0;
    if (transformStyle) {
        const match = transformStyle.match(/translateX\((.+)px\)/);
        if (match && match[1]) {
            currentX = parseFloat(match[1]);
        }
    }
    
    // Обновляем ширину панели и текста для точных расчетов
    panelWidth = translationPanel.offsetWidth;
    translationTextWidth = translationContent.scrollWidth;
    
    // Рассчитываем максимальное смещение влево
    const maxOffset = Math.max(panelWidth - translationTextWidth, 0);
    
    // Прокручиваем на 1/3 ширины панели вперед
    const scrollAmount = panelWidth / 3;
    const newX = Math.max(maxOffset, currentX - scrollAmount);
    
    // Применяем новую позицию с анимацией
    translationContent.style.transform = `translateX(${newX}px)`;
}

// Функция для прокрутки перевода в конец текста
function scrollTranslationToEnd() {
    if (!translationContent || !translationPanel) return;
    
    // Получаем текущую позицию
    const transformStyle = translationContent.style.transform;
    let currentX = 0;
    if (transformStyle) {
        const match = transformStyle.match(/translateX\((.+)px\)/);
        if (match && match[1]) {
            currentX = parseFloat(match[1]);
        }
    }
    
    // Обновляем ширину панели и текста для точных расчетов
    panelWidth = translationPanel.offsetWidth;
    translationTextWidth = translationContent.scrollWidth;
    
    // Рассчитываем максимальное смещение влево
    const maxOffset = Math.max(panelWidth - translationTextWidth, 0);
    
    // Прокручиваем на полную ширину панели вперед
    const newX = maxOffset;
    
    // Применяем новую позицию с анимацией
    translationContent.style.transform = `translateX(${newX}px)`;
}

// Функция озвучивания текста с анимацией кнопки
function speakText(text, lang = 'en-US', buttonId) {
    // Проверяем поддержку Web Speech API
    if ('speechSynthesis' in window) {
        // Находим кнопку, если указан её ID
        let button = null;
        if (buttonId) {
            button = document.getElementById(buttonId);
            if (button) {
                // Добавляем класс анимации
                button.classList.add('speak-button-active');
            }
        }
        
        // Создаем экземпляр SpeechSynthesisUtterance
        const utterance = new SpeechSynthesisUtterance(text);
        
        // Устанавливаем язык
        utterance.lang = lang;
        
        // Событие, когда озвучивание закончено
        utterance.onend = function() {
            if (button) {
                // Убираем класс анимации
                button.classList.remove('speak-button-active');
            }
        };
        
        // Озвучиваем текст
        window.speechSynthesis.speak(utterance);
    } else {
        console.error('Web Speech API не поддерживается в этом браузере');
    }
}

// Показать перевод слова
function showTranslation(translationData, position) {
    console.log('Вызов showTranslation с данными:', translationData, 'и позицией:', position);
    
    const translationPanel = document.getElementById("translationPanel");
    const translationContent = document.getElementById("translationContent");
    
    if (!translationPanel || !translationContent) {
        console.error("Элементы панели перевода не найдены");
        return;
    }
    
    // Проверяем, является ли translationData объектом или строкой
    let word, translation, context;
    
    if (typeof translationData === 'object' && translationData !== null) {
        // Если передан объект с данными
        console.log('translationData является объектом');
        word = translationData.word || '';
        translation = translationData.translation || '';
        context = translationData.context || '';
    } else {
        // Обратная совместимость со старым форматом
        console.log('translationData не является объектом, используем аргументы напрямую');
        word = arguments[0] || '';
        translation = arguments[1] || '';
        context = arguments[2] || '';
    }
    
    // Логируем данные для отладки
    console.log('Распакованные данные для отображения:', { word, translation, context });
    
    // Преобразуем все значения в строки
    word = String(word || '').replace(/[<>]/g, '');
    translation = String(translation || '').replace(/[<>]/g, '');
    
    console.log('Очищенные данные:', { word, translation });
    
    // Создаем уникальные ID для кнопок
    const origButtonId = `speak-orig-${Date.now()}`;
    const transButtonId = `speak-trans-${Date.now()}`;
    const dictButtonId = `dict-btn-${Date.now()}`;
    
    // Добавляем кнопки озвучивания для оригинала и перевода
    const origSpeakButton = `<button id="${origButtonId}" class="speak-button" onclick="speakText('${word}', 'en-US', '${origButtonId}')">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
        </svg>
    </button>`;
    
    const transSpeakButton = `<button id="${transButtonId}" class="speak-button" onclick="speakText('${translation}', 'ru-RU', '${transButtonId}')">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
        </svg>
    </button>`;
    
    // Добавляем кнопку словаря
    const dictButton = `<button id="${dictButtonId}" class="btn btn-sm btn-outline-success" onclick="addWordToDictionary('${word}', '${translation}')">
        + В словарь
    </button>`;
    
    // Формируем HTML для панели перевода
    const html = `
        <div class="translation-header">
            <div class="translation-word">${word}</div>
            <div class="translation-actions">
                ${origSpeakButton}
                ${transSpeakButton}
                ${dictButton}
            </div>
        </div>
        <div class="translation-text">${translation}</div>
    `;
    
    console.log('Обновляем HTML панели перевода');
    
    // Обновляем содержимое панели
    translationContent.innerHTML = html;
    
    // Сбрасываем смещение для нового текста
    translationContent.style.transform = 'translateX(0px)';
    
    // Убедимся, что панель отображается
    translationPanel.style.display = "block";
    
    // Выделим панель на короткое время, чтобы привлечь внимание
    translationPanel.classList.add("highlight-translation");
    setTimeout(() => {
        translationPanel.classList.remove("highlight-translation");
    }, 300);
}

// Функция для добавления слова в словарь через кнопку
async function addWordToDictionary(word, translation, context) {
    try {
        // Проверяем входные данные
        if (!word || !translation) {
            console.error('Недостаточно данных для добавления в словарь:', { word, translation });
            alert('Ошибка: слово или перевод отсутствуют');
            return false;
        }
        
        const token = getAuthToken();
        if (!token) {
            console.error('Отсутствует токен авторизации');
            alert('Ошибка авторизации. Пожалуйста, обновите страницу и войдите заново.');
            return false;
        }

        // Обезопасим входные данные, преобразуя их в строки
        word = String(word).replace(/[<>]/g, '').trim();
        translation = String(translation).replace(/[<>]/g, '').trim();
        
        console.log('Добавление в словарь:', { word, translation });

        const data = {
            word: word,
            translation: translation,
            context: "" // Пустой контекст
        };
        
        console.log('Отправляемые данные:', data);
        
        const response = await fetch('/api/dictionary', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(data)
        });

        let responseData;
        const responseText = await response.text();
        console.log('Ответ сервера:', response.status, responseText);
        
        try {
            // Пробуем разобрать ответ как JSON
            responseData = JSON.parse(responseText);
        } catch (e) {
            // Если не получилось, используем текст как есть
            responseData = { message: responseText };
        }
        
        if (response.ok) {
            console.log('Слово успешно добавлено в словарь');
            
            // Обновляем кнопку
            const dictButton = document.querySelector(`button[id^="dict-btn-"]`);
            if (dictButton) {
                dictButton.classList.remove('btn-outline-success');
                dictButton.classList.add('btn-success');
                dictButton.innerHTML = '✓ В словаре';
                dictButton.disabled = true;
            } else {
                console.warn('Кнопка словаря не найдена для обновления');
            }
            
            // Обновляем стиль слова в тексте
            const wordElements = document.querySelectorAll(`[data-word="${word}"]`);
            if (wordElements.length > 0) {
                wordElements.forEach(element => {
                    element.classList.add('in-dictionary');
                });
            } else {
                console.warn('Элементы слова не найдены в тексте');
            }
            
            return true;
        } else {
            const errorMessage = responseData.error || 'Неизвестная ошибка';
            console.error('Ошибка при добавлении слова в словарь:', response.status, errorMessage);
            alert(`Не удалось добавить слово в словарь: ${errorMessage}`);
        }
    } catch (error) {
        console.error('Ошибка при добавлении слова в словарь:', error);
        alert('Произошла ошибка при добавлении слова в словарь');
    }
    
    return false;
}

// Обработчик клика по тексту
function handleTextClick(event) {
    // Предотвращаем стандартное действие по клику
    event.preventDefault();
    
    // Проверяем, что кликнули на текст
    const textLayer = closestByClass(event.target, 'textLayer');
    if (!textLayer) return;
    
    // Получаем позицию клика для отображения панели перевода
    const position = {
        x: event.clientX,
        y: event.clientY
    };
    
    const selection = window.getSelection();
    if (selection.rangeCount === 0) return;
    
    const range = selection.getRangeAt(0);
    const selectedText = range.toString().trim();
    
    if (selectedText.length === 0) {
        // Если нет выделенного текста, ищем слово в месте клика
        const word = findWordAtPosition(event.target, event.clientX, event.clientY);
        if (word) {
            console.log('Найдено слово при клике:', word);
            translateWordOnClick(word, position);
        }
    } else if (selectedText.split(/\s+/).length === 1) {
        // Если выделено одно слово
        console.log('Выделено слово:', selectedText);
        translateWordOnClick(selectedText, position);
    } else {
        // Если выделено несколько слов
        console.log('Выделено несколько слов:', selectedText);
        translatePhraseOnClick(selectedText, position);
    }
}

// Функция для перевода выбранного слова при клике
async function translateWordOnClick(word, position) {
    const currentPageNum = PDFViewerApplication.page;
    
    // Очищаем от знаков препинания для лучшего сопоставления
    word = word.replace(/[.,!?;:()"']/g, '').trim();
    
    if (word.length === 0) {
        console.log('Пустое слово после очистки');
        return;
    }
    
    try {
        // Получаем текст текущей страницы
        const textContent = await PDFViewerApplication.pdfViewer.getPageTextContent(currentPageNum);
        const pageText = textContent.items.map(item => item.str).join(' ');
        
        // Переводим слово с учетом контекста
        translateWordInContext(word, pageText, currentPageNum, position);
    } catch (error) {
        console.error('Ошибка при получении текста страницы:', error);
    }
}

// Функция для перевода выбранной фразы при клике
async function translatePhraseOnClick(phrase, position) {
    const currentPageNum = PDFViewerApplication.page;
    
    // Очищаем от лишних пробелов
    phrase = phrase.trim();
    
    if (phrase.length === 0) {
        console.log('Пустая фраза');
        return;
    }
    
    try {
        // Получаем текст текущей страницы для контекста
        const textContent = await PDFViewerApplication.pdfViewer.getPageTextContent(currentPageNum);
        const pageText = textContent.items.map(item => item.str).join(' ');
        
        // Переводим фразу с учетом контекста
        translateWordInContext(phrase, pageText, currentPageNum, position);
    } catch (error) {
        console.error('Ошибка при переводе фразы:', error);
    }
}

// Вспомогательная функция для поиска ближайшего элемента с заданным классом
function closestByClass(element, className) {
    while (element) {
        if (element.classList && element.classList.contains(className)) {
            return element;
        }
        element = element.parentElement;
    }
    return null;
}

// Функция для поиска слова в месте клика
function findWordAtPosition(element, x, y) {
    // Если элемент не содержит текст, возвращаем null
    if (!element.textContent || element.textContent.trim() === '') {
        return null;
    }
    
    // Для текстовых узлов находим ближайшее слово
    if (element.nodeType === Node.TEXT_NODE || !element.children.length) {
        const text = element.textContent;
        
        // Разбиваем текст на слова
        const words = text.split(/\s+/);
        if (words.length === 1) {
            return words[0].replace(/[.,!?;:()"']/g, '');
        }
        
        // Если в элементе несколько слов, берем все содержимое
        // В реальном приложении здесь будет более сложная логика выбора нужного слова
        return text.trim();
    }
    
    // Для элементов с дочерними узлами проверяем каждый дочерний элемент
    for (let i = 0; i < element.children.length; i++) {
        const child = element.children[i];
        const rect = child.getBoundingClientRect();
        
        // Проверяем, попадает ли позиция клика в границы элемента
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            return findWordAtPosition(child, x, y);
        }
    }
    
    return element.textContent.trim();
}

// Инициализация PDF-просмотрщика
function initPDFViewer() {
    console.log('Инициализация просмотрщика PDF...');
    
    // Проверка авторизации
    const token = localStorage.getItem('token');
    if (!token) {
        console.log('Токен не найден, перенаправление на страницу входа');
        window.location.href = '/';
        return;
    }
    
    const pdfUrl = getPdfUrl();
    if (!pdfUrl) {
        console.error('URL PDF не найден');
        return;
    }
    
    console.log('Загрузка PDF:', pdfUrl);
    
    // Загрузка PDF
    pdfjsLib.getDocument(pdfUrl).promise.then(function(pdf) {
        console.log('PDF загружен, страниц:', pdf.numPages);
        pdfDoc = pdf;
        document.getElementById('page-count').textContent = pdf.numPages;
        
        // Начальный рендеринг первой страницы
        renderPage(pageNum);
        
        // Включить кнопки, когда PDF загружен
        document.getElementById('prev-page').disabled = false;
        document.getElementById('next-page').disabled = false;
    }).catch(function(error) {
        console.error('Ошибка при загрузке PDF:', error);
        showError('Невозможно загрузить PDF файл: ' + error.message);
    });
    
    // Обработчики событий
    document.getElementById('prev-page').addEventListener('click', onPrevPage);
    document.getElementById('next-page').addEventListener('click', onNextPage);
    
    document.getElementById('zoom-in').addEventListener('click', function() {
        if (scale < 3.0) {
            scale += 0.25;
            document.getElementById('zoom-select').value = scale;
            queueRenderPage(pageNum);
        }
    });
    
    document.getElementById('zoom-out').addEventListener('click', function() {
        if (scale > 0.25) {
            scale -= 0.25;
            document.getElementById('zoom-select').value = scale;
            queueRenderPage(pageNum);
        }
    });
    
    document.getElementById('zoom-select').addEventListener('change', function() {
        scale = parseFloat(this.value);
        queueRenderPage(pageNum);
    });
    
    document.getElementById('full-screen').addEventListener('click', toggleFullScreen);
    
    // Обработка клавиатурных событий
    window.addEventListener('keydown', function(e) {
        if (e.key === 'ArrowRight' || e.key === 'j') {
            onNextPage();
        } else if (e.key === 'ArrowLeft' || e.key === 'k') {
            onPrevPage();
        } else if (e.key === '+') {
            if (scale < 3.0) {
                scale += 0.25;
                document.getElementById('zoom-select').value = scale;
                queueRenderPage(pageNum);
            }
        } else if (e.key === '-') {
            if (scale > 0.25) {
                scale -= 0.25;
                document.getElementById('zoom-select').value = scale;
                queueRenderPage(pageNum);
            }
        } else if (e.key === 'f') {
            toggleFullScreen();
        }
    });
}

// Обработчик клика по текстовому слою
function handleTextLayerClick(event) {
    // Получаем выделенный текст
    const selection = window.getSelection();
    if (selection.toString().trim() === '') {
        console.log('Нет выделенного текста, ищем слово под курсором');
        
        // Если нет выделенного текста, пытаемся найти слово под курсором
        const element = document.elementFromPoint(event.clientX, event.clientY);
        if (element && element.textContent) {
            const word = findWordInElementAtPosition(element, event.clientX, event.clientY);
            if (word) {
                console.log('Найдено слово в текстовом слое:', word);
                translateWordInContext(word, element.textContent, pageNum, null);
                return;
            }
        }
    } else {
        // Если текст выделен, переводим его
        const selectedText = selection.toString().trim();
        console.log('Выделен текст для перевода:', selectedText);
        
        if (selectedText.split(/\s+/).length <= 3) {
            // Для коротких фраз (до 3 слов) используем контекстный перевод
            translateWordInContext(selectedText, getContextAroundSelection(), pageNum, null);
        } else {
            // Для длинных фраз просто переводим их
            translateWordInContext(selectedText, selectedText, pageNum, null);
        }
    }
}

// Получение контекста вокруг выделенного текста
function getContextAroundSelection() {
    const selection = window.getSelection();
    if (!selection.rangeCount) return '';
    
    const range = selection.getRangeAt(0);
    const node = range.startContainer;
    
    // Получаем родительский элемент, содержащий текст
    let parent = node;
    while (parent && parent.nodeType !== Node.ELEMENT_NODE) {
        parent = parent.parentNode;
    }
    
    return parent ? parent.textContent : '';
}

// Поиск слова в элементе по позиции клика
function findWordInElementAtPosition(element, x, y) {
    const text = element.textContent;
    if (!text) return null;
    
    // Получаем информацию о позиции элемента
    const rect = element.getBoundingClientRect();
    
    // Рассчитываем примерную позицию символа в тексте
    const relX = x - rect.left;
    const charWidth = rect.width / text.length;
    const charIndex = Math.floor(relX / charWidth);
    
    if (charIndex < 0 || charIndex >= text.length) return null;
    
    // Находим начало и конец слова
    let startIndex = charIndex;
    let endIndex = charIndex;
    
    // Ищем начало слова
    while (startIndex > 0 && /[\w''-]/.test(text[startIndex - 1])) {
        startIndex--;
    }
    
    // Ищем конец слова
    while (endIndex < text.length - 1 && /[\w''-]/.test(text[endIndex + 1])) {
        endIndex++;
    }
    
    // Проверяем найденное слово
    if (endIndex >= startIndex && /[\w''-]/.test(text[startIndex])) {
        const word = text.substring(startIndex, endIndex + 1);
        
        // Очищаем слово от знаков пунктуации по краям
        return word.replace(/^[^\w]+|[^\w]+$/g, '');
    }
    
    return null;
}

// Функция для озвучивания слова
function speakWord(text, lang = 'en-US') {
    if (!text) return;
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    
    // Останавливаем предыдущее озвучивание
    window.speechSynthesis.cancel();
    
    // Запускаем новое озвучивание
    window.speechSynthesis.speak(utterance);
}

// Функция для проверки слова в словаре
async function checkWordInDictionary(word) {
    try {
        // Проверка входных данных
        if (!word || typeof word !== 'string') {
            console.error('Некорректное слово для проверки в словаре:', word);
            return false;
        }
        
        // Очищаем слово от знаков препинания и лишних пробелов
        word = word.trim().replace(/[.,!?;:()"']/g, '');
        
        const token = getAuthToken();
        if (!token) {
            console.error('Отсутствует токен авторизации');
            return false;
        }
        
        const response = await fetch(`/api/dictionary/check?word=${encodeURIComponent(word)}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            console.error('Ошибка при проверке слова в словаре:', response.status);
            return false;
        }
        
        const data = await response.json();
        return data.exists || false;
    } catch (error) {
        console.error('Ошибка при проверке слова в словаре:', error);
        return false;
    }
}

// Функция для добавления слова в словарь
async function addToDictionary(word, translation, context) {
    try {
        const token = getAuthToken();
        if (!token) {
            console.error('Отсутствует токен авторизации');
            return false;
        }
        
        // Обезопасим входные данные, преобразуя их в строки
        word = String(word).replace(/[<>]/g, '');
        translation = String(translation).replace(/[<>]/g, '');
        context = context ? String(context).replace(/[<>]/g, '') : '';
        
        console.log('Добавление в словарь (addToDictionary):', { word, translation, context });
        
        const response = await fetch('/api/dictionary', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                word,
                translation,
                context
            })
        });
        
        if (response.ok) {
            console.log('Слово успешно добавлено в словарь');
            
            // Обновляем стиль слова в тексте
            const wordElements = document.querySelectorAll(`[data-word="${word}"]`);
            wordElements.forEach(element => {
                element.classList.add('in-dictionary');
            });
            return true;
        } else {
            console.error('Ошибка при добавлении слова в словарь:', response.status);
        }
    } catch (error) {
        console.error('Ошибка при добавлении слова в словарь:', error);
    }
    return false;
}

// Обновляем функцию showTranslation
async function showDictionaryWordTranslation(word, translation, context) {
    const translationPanel = document.getElementById('translationPanel');
    const translationContent = document.getElementById('translationContent');
    
    if (!translationPanel || !translationContent) return;
    
    // Проверяем, есть ли слово в словаре
    const isInDictionary = await checkWordInDictionary(word);
    
    // Создаем HTML для панели перевода
    let html = `
        <div class="translation-header">
            <h3>${word}</h3>
            <div class="translation-actions">
                <button class="btn btn-sm btn-outline-primary" onclick="speakWord('${word}', 'en-US')">
                    🔊 EN
                </button>
                <button class="btn btn-sm btn-outline-primary" onclick="speakWord('${translation}', 'ru-RU')">
                    🔊 RU
                </button>
                <button class="btn btn-sm ${isInDictionary ? 'btn-success' : 'btn-outline-success'}" 
                        onclick="toggleDictionary('${word}', '${translation}', '${context}')">
                    ${isInDictionary ? '✓ В словаре' : '+ В словарь'}
                </button>
            </div>
        </div>
        <div class="translation-body">
            <div class="translation-text">${translation}</div>
            ${context ? `<div class="translation-context">${context}</div>` : ''}
        </div>
    `;
    
    translationContent.innerHTML = html;
    translationPanel.style.display = 'block';
    
    // Добавляем эффект подсветки
    translationPanel.classList.add('highlight-translation');
    setTimeout(() => {
        translationPanel.classList.remove('highlight-translation');
    }, 300);
}

// Функция для переключения состояния слова в словаре
async function toggleDictionary(word, translation, context) {
    const isInDictionary = await checkWordInDictionary(word);
    if (!isInDictionary) {
        const success = await addToDictionary(word, translation, context);
        if (success) {
            // Обновляем кнопку
            const button = document.querySelector('.translation-actions button:last-child');
            if (button) {
                button.classList.remove('btn-outline-success');
                button.classList.add('btn-success');
                button.textContent = '✓ В словаре';
            }
            // Обновляем стиль слова в тексте
            const wordElements = document.querySelectorAll(`[data-word="${word}"]`);
            wordElements.forEach(element => {
                element.classList.add('in-dictionary');
            });
        }
    }
}

// Функция для загрузки и отображения слов из словаря
async function loadDictionaryWords() {
    try {
        const token = getAuthToken();
        const response = await fetch('/api/dictionary', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        const data = await response.json();
        
        // Помечаем слова в тексте
        data.words.forEach(word => {
            const wordElements = document.querySelectorAll(`[data-word="${word.word}"]`);
            wordElements.forEach(element => {
                element.classList.add('in-dictionary');
            });
        });
    } catch (error) {
        console.error('Ошибка при загрузке слов из словаря:', error);
    }
}

// Добавляем вызов загрузки слов из словаря при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    loadDictionaryWords();
});

// ... existing code ... 
// ... existing code ... 

// ... existing code ...
async function showDictionaryTranslation(word, translation, context) {
    const translationPanel = document.getElementById('translationPanel');
    const translationContent = document.getElementById('translationContent');
    
    if (!translationPanel || !translationContent) {
        console.error("Элементы панели перевода не найдены");
        return;
    }
    
    // Обезопасим входные данные, преобразуя их в строки
    word = String(word).replace(/[<>]/g, '');
    translation = String(translation).replace(/[<>]/g, '');
    context = context ? String(context).replace(/[<>]/g, '') : '';
    
    // Проверяем, есть ли слово в словаре
    let isInDictionary = false;
    try {
        isInDictionary = await checkWordInDictionary(word);
    } catch (error) {
        console.error('Ошибка при проверке слова в словаре:', error);
    }
    
    // Формируем HTML для панели с переводом
    let html = `
        <div class="translation-header">
            <div class="translation-word">${word}</div>
            <div class="translation-actions">
                <button class="speak-button" onclick="speakWord('${word}', 'en-US')">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                    </svg>
                </button>
                <button class="speak-button" onclick="speakWord('${translation}', 'ru-RU')">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                    </svg>
                </button>
                <button class="btn btn-sm ${isInDictionary ? 'btn-success' : 'btn-outline-success'}" 
                        onclick="toggleDictionary('${word}', '${translation}', '${context}')">
                    ${isInDictionary ? '✓ В словаре' : '+ В словарь'}
                </button>
            </div>
        </div>
        <div class="translation-text">${translation}</div>
        ${context ? `<div class="translation-context">${context}</div>` : ''}
    `;
    
    // Обновляем содержимое панели
    translationContent.innerHTML = html;
    translationPanel.style.display = 'block';
    
    // Выделим панель на короткое время, чтобы привлечь внимание
    translationPanel.classList.add("highlight-translation");
    setTimeout(() => {
        translationPanel.classList.remove("highlight-translation");
    }, 300);
}
// ... existing code ... 