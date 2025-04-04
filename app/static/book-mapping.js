/**
 * Функционал для работы с предварительно подготовленными сопоставлениями текстов
 */

// Глобальные переменные для сопоставления
let hasBookMapping = false;
let currentBookFilename = '';
let cachedMapping = null;

// Инициализация функционала сопоставления
function initBookMapping(hasMappingFlag, bookFilename) {
    hasBookMapping = hasMappingFlag;
    currentBookFilename = bookFilename;
    
    console.log(`Инициализация сопоставления: hasMappingFlag=${hasMappingFlag}, filename=${bookFilename}`);
    
    if (hasBookMapping) {
        // Предварительно загружаем сопоставление
        getBookMapping().then(mapping => {
            cachedMapping = mapping;
            console.log('Сопоставление успешно загружено');
        }).catch(error => {
            console.error('Ошибка при загрузке сопоставления:', error);
        });
    }
}

// Функция для получения сопоставления
async function getBookMapping() {
    if (!hasBookMapping) {
        return null;
    }
    
    // Если сопоставление уже загружено, возвращаем его
    if (cachedMapping) {
        return cachedMapping;
    }
    
    // Получаем токен авторизации
    const token = localStorage.getItem('token');
    if (!token) {
        console.error('Отсутствует токен авторизации');
        return null;
    }
    
    try {
        const response = await fetch(`/api/book-mapping/${currentBookFilename}`, {
            headers: {
                "Authorization": `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            console.error('Ошибка загрузки сопоставления для книги:', response.status);
            return null;
        }
        
        const mapping = await response.json();
        cachedMapping = mapping;
        return mapping;
    } catch (error) {
        console.error('Ошибка загрузки сопоставления для книги:', error);
        return null;
    }
}

// Функция для поиска перевода с использованием сопоставления
async function findTranslationWithMapping(word, context) {
    if (!hasBookMapping) {
        return null;
    }
    
    const mapping = await getBookMapping();
    if (!mapping) {
        return null;
    }
    
    // Ищем параграф, наиболее соответствующий контексту
    const bestMatch = findBestParagraphMatch(context, mapping);
    if (!bestMatch || bestMatch.score < 0.7) {
        console.log('Не найдено подходящее сопоставление для контекста');
        return null;
    }
    
    console.log('Найдено сопоставление с коэффициентом сходства:', bestMatch.score);
    
    return {
        word: word,
        translation: bestMatch.translation,
        context: bestMatch.russianParagraph,
        exact_match: true
    };
}

// Функция для поиска параграфа, наиболее соответствующего контексту
function findBestParagraphMatch(context, mapping) {
    // Нормализуем контекст
    const normalizedContext = context.trim().toLowerCase();
    
    let bestMatch = null;
    let bestScore = 0;
    
    // Проходим по всем параграфам в сопоставлении
    for (const paraIndex in mapping) {
        const para = mapping[paraIndex];
        const engPara = para.english.trim().toLowerCase();
        
        // Используем алгоритм "сходства последовательностей"
        const similarity = calculateStringSimilarity(normalizedContext, engPara);
        
        if (similarity > bestScore) {
            bestScore = similarity;
            bestMatch = {
                russianParagraph: para.russian,
                englishParagraph: para.english,
                translation: para.russian, // используем весь русский параграф как перевод
                score: similarity
            };
        }
    }
    
    return bestMatch;
}

// Функция для вычисления сходства строк (простой алгоритм Dice coefficient)
function calculateStringSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1;
    
    // Создаем биграммы (пары символов)
    const getBigrams = str => {
        const bigrams = new Set();
        for (let i = 0; i < str.length - 1; i++) {
            bigrams.add(str.substring(i, i + 2));
        }
        return bigrams;
    };
    
    const bigrams1 = getBigrams(str1);
    const bigrams2 = getBigrams(str2);
    
    // Находим пересечение биграмм
    let intersection = 0;
    for (const bigram of bigrams1) {
        if (bigrams2.has(bigram)) {
            intersection++;
        }
    }
    
    // Вычисляем коэффициент Дайса
    return (2 * intersection) / (bigrams1.size + bigrams2.size);
} 