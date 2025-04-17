import logging
from fastapi import FastAPI, Depends, HTTPException, status, File, UploadFile, Form, Query, Body, Cookie
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, timedelta
from jose import JWTError, jwt
from passlib.context import CryptContext
import sqlite3
import uuid
import os
import shutil
from pathlib import Path
import requests
import re
import json
from deep_translator import GoogleTranslator
from fastapi.templating import Jinja2Templates
from fastapi import Request
from sqlite3 import IntegrityError
import hashlib
import secrets
from sqlalchemy import create_engine, text

# Настраиваем логирование
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Создаем SQLAlchemy engine для работы с базой данных
engine = create_engine("sqlite:///app.db", connect_args={"check_same_thread": False})

# Создаем инстанс FastAPI
app = FastAPI(
    title="Book Reader & Translator",
    description="""
    Приложение для чтения и изучения книг с расширенными возможностями перевода и озвучивания.
    
    Основные функции:
    - Просмотр PDF книг с удобной навигацией
    - Двухпанельный перевод: отдельных слов при клике и полного текста страницы
    - Озвучивание как оригинальных слов, так и их переводов
    - Возможность подготовки книг с предварительным сопоставлением параллельных текстов
    - Система авторизации с персональной библиотекой файлов
    - Перетаскиваемые панели для удобного просмотра длинных переводов
    - Адаптивный интерфейс, оптимизированный для чтения
    
    Идеально подходит для изучения иностранных языков через чтение литературы.
    """,
    version="1.0.0",
    contact={
        "name": "Books Reader & Translator",
        "email": "support@example.com",
    }
)

# Настройки JWT
SECRET_KEY = "supersecretkey"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

# Директория для загрузки файлов
UPLOAD_DIR = Path("uploads")
if not UPLOAD_DIR.exists():
    UPLOAD_DIR.mkdir(parents=True)

# Настройка CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Обслуживание статических файлов
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# Инициализация базы данных
def init_db():
    conn = sqlite3.connect('app.db')
    cursor = conn.cursor()
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        email TEXT UNIQUE,
        hashed_password TEXT,
        is_active BOOLEAN DEFAULT 1,
        is_superuser BOOLEAN DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS user_files (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        filename TEXT,
        original_filename TEXT,
        file_size INTEGER,
        upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
    ''')
    
    # Создаем таблицу для хранения сопоставлений текстов
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS files_with_mapping
    (id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL,
    mapping_data TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (file_id) REFERENCES user_files (id) ON DELETE CASCADE,
    UNIQUE(file_id))
    ''')
    
    # Создаем таблицу для хранения информации о подготовленных файлах, если она не существует
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS user_dictionary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        word TEXT NOT NULL,
        translation TEXT NOT NULL,
        context TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
    ''')
    
    conn.commit()
    conn.close()
    logger.info("Database initialized")

# Схемы данных
class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    username: Optional[str] = None

class UserBase(BaseModel):
    username: str
    email: Optional[str] = None
    is_active: Optional[bool] = True
    is_superuser: bool = False

class UserCreate(UserBase):
    password: str

class User(UserBase):
    id: str

class UserFile(BaseModel):
    id: str
    filename: str
    original_filename: str
    file_size: int
    upload_date: str

# Pydantic модель для запроса /api/prepare-book
class PrepareBookRequest(BaseModel):
    file_id: str
    english_text: str
    russian_text: str

# Настройка безопасности
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/token")

# Функции для работы с паролями и токенами
def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

# Функции для работы с пользователями
def get_user(username: str):
    conn = sqlite3.connect('app.db')
    cursor = conn.cursor()
    cursor.execute("SELECT id, username, email, hashed_password, is_active, is_superuser FROM users WHERE username = ?", (username,))
    user = cursor.fetchone()
    conn.close()
    
    if user:
        return {
            "id": user[0],
            "username": user[1],
            "email": user[2],
            "hashed_password": user[3],
            "is_active": bool(user[4]),
            "is_superuser": bool(user[5])
        }
    return None

def create_user(user: UserCreate):
    hashed_password = get_password_hash(user.password)
    user_id = str(uuid.uuid4())
    
    conn = sqlite3.connect('app.db')
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO users (id, username, email, hashed_password, is_active, is_superuser) VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, user.username, user.email, hashed_password, user.is_active, user.is_superuser)
        )
        conn.commit()
        return {
            "id": user_id,
            "username": user.username,
            "email": user.email,
            "is_active": user.is_active,
            "is_superuser": user.is_superuser
        }
    except sqlite3.IntegrityError:
        conn.rollback()
        return None
    finally:
        conn.close()

async def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
        token_data = TokenData(username=username)
    except JWTError:
        raise credentials_exception
    user = get_user(username=token_data.username)
    if user is None:
        raise credentials_exception
    return user

async def get_current_active_user(current_user = Depends(get_current_user)):
    if not current_user["is_active"]:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user

# Функции для работы с файлами
def save_uploaded_file(file: UploadFile, user_id: str) -> Optional[dict]:
    """Сохраняет загруженный файл и создаёт запись в БД"""
    try:
        # Создаем уникальное имя файла
        file_id = str(uuid.uuid4())
        file_extension = os.path.splitext(file.filename)[1].lower()
        
        # Проверяем, что файл - PDF
        if file_extension != '.pdf':
            return None
        
        # Формируем новое имя файла
        new_filename = f"{file_id}{file_extension}"
        file_path = UPLOAD_DIR / new_filename
        
        # Сохраняем файл
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Получаем размер файла
        file_size = os.path.getsize(file_path)
        
        # Сохраняем информацию о файле в БД
        conn = sqlite3.connect('app.db')
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO user_files (id, user_id, filename, original_filename, file_size) VALUES (?, ?, ?, ?, ?)",
            (file_id, user_id, new_filename, file.filename, file_size)
        )
        conn.commit()
        conn.close()
        
        return {
            "id": file_id,
            "filename": new_filename,
            "original_filename": file.filename,
            "file_size": file_size,
            "upload_date": datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Error saving file: {e}")
        return None

def get_user_files(user_id: str) -> List[dict]:
    """Получает список файлов пользователя"""
    conn = sqlite3.connect('app.db')
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, filename, original_filename, file_size, upload_date FROM user_files WHERE user_id = ? ORDER BY upload_date DESC", 
        (user_id,)
    )
    files = cursor.fetchall()
    conn.close()
    
    result = []
    for file in files:
        result.append({
            "id": file[0],
            "filename": file[1],
            "original_filename": file[2],
            "file_size": file[3],
            "upload_date": file[4]
        })
    
    return result

def delete_user_file(file_id: str, user_id: str) -> bool:
    """Удаляет файл пользователя"""
    conn = sqlite3.connect('app.db')
    cursor = conn.cursor()
    
    # Проверяем, что файл принадлежит пользователю
    cursor.execute("SELECT filename FROM user_files WHERE id = ? AND user_id = ?", (file_id, user_id))
    file = cursor.fetchone()
    
    if not file:
        conn.close()
        return False
    
    # Удаляем файл с диска
    file_path = UPLOAD_DIR / file[0]
    if os.path.exists(file_path):
        os.remove(file_path)
    
    # Удаляем запись из БД
    cursor.execute("DELETE FROM user_files WHERE id = ?", (file_id,))
    conn.commit()
    conn.close()
    
    return True

# API маршруты
@app.post("/api/token", response_model=Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends()):
    user = get_user(form_data.username)
    if not user or not verify_password(form_data.password, user["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user["username"]}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@app.post("/api/register", response_model=User)
async def register_user(user: UserCreate):
    db_user = get_user(user.username)
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    
    created_user = create_user(user)
    if not created_user:
        raise HTTPException(status_code=400, detail="Error creating user")
        
    return created_user

@app.get("/api/users/me", response_model=User)
async def read_users_me(current_user = Depends(get_current_active_user)):
    return current_user

# API для работы с файлами
@app.post("/api/files/upload")
async def upload_file(
    file: UploadFile = File(...),
    current_user = Depends(get_current_active_user)
):
    logger.info(f"Uploading file: {file.filename} for user {current_user['username']}")
    try:
        result = save_uploaded_file(file, current_user["id"])
        if not result:
            logger.error(f"Error saving file {file.filename}")
            raise HTTPException(status_code=400, detail="Error uploading file. Only PDF files are allowed.")
        logger.info(f"File uploaded successfully: {result}")
        return result
    except Exception as e:
        logger.error(f"Exception during file upload: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Server error: {str(e)}")

@app.get("/api/files", response_model=List[UserFile])
async def list_files(current_user = Depends(get_current_active_user)):
    files = get_user_files(current_user["id"])
    return files

@app.delete("/api/files/{file_id}")
async def delete_file(file_id: str, current_user = Depends(get_current_active_user)):
    success = delete_user_file(file_id, current_user["id"])
    if not success:
        raise HTTPException(status_code=404, detail="File not found or permission denied")
    return {"status": "success", "message": "File deleted successfully"}

# Класс для запроса перевода
class TranslationRequest(BaseModel):
    text: str
    source_lang: str = Field(default="en")
    target_lang: str = Field(default="ru")

# Функция для перевода через DeepTranslator
def deep_translate(text, source_lang="en", target_lang="ru"):
    """
    Использует библиотеку deep-translator для перевода текста
    """
    if not text or text.strip() == "":
        return ""
        
    try:
        # Ограничение длины для API
        chunk_size = 4500
        
        # Делим текст на части, если он слишком длинный
        if len(text) > chunk_size:
            chunks = [text[i:i+chunk_size] for i in range(0, len(text), chunk_size)]
            translated_chunks = []
            
            # Переводим каждый кусок отдельно
            for chunk in chunks:
                translator = GoogleTranslator(source=source_lang, target=target_lang)
                translated = translator.translate(chunk)
                translated_chunks.append(translated)
            
            # Объединяем переведенные куски
            return " ".join(translated_chunks)
        else:
            # Если текст достаточно короткий, переводим целиком
            translator = GoogleTranslator(source=source_lang, target=target_lang)
            return translator.translate(text)
            
    except Exception as e:
        logging.error(f"DeepTranslator error: {str(e)}")
        # Если возникла ошибка, используем локальный словарь
        return simple_translate(text)

# API для перевода текста
@app.post("/api/translate")
async def translate_text(
    request: TranslationRequest,
    current_user: User = Depends(get_current_user)
):
    try:
        # Ограничиваем длину текста для стабильности
        max_length = 8000
        text = request.text
        
        if len(text) > max_length:
            logging.warning(f"Text too long: {len(text)} chars, truncating to {max_length}")
            text = text[:max_length]
            
        # Используем DeepTranslator для перевода
        translated_text = deep_translate(
            text,
            source_lang=request.source_lang,
            target_lang=request.target_lang
        )
        
        # Проверяем результат
        if not translated_text:
            raise HTTPException(status_code=500, detail="Empty translation result")
            
        return {"translated_text": translated_text}
    except Exception as e:
        logging.error(f"Translation error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Translation error: {str(e)}")

# Оставляем словарный метод как последний запасной вариант
def simple_translate(text):
    try:
        logging.info(f"Translating text: {text}")
        
        # Если текст пустой, вернуть пустую строку
        if not text or text.strip() == "":
            return ""
            
        # Разбиваем текст на слова, сохраняя пунктуацию
        words_with_punct = re.findall(r'[\w\']+|[.,!?;:()]', text)
        
        translated_words = []
        
        for word in words_with_punct:
            # Игнорируем пунктуацию
            if re.match(r'^[.,!?;:()]$', word):
                translated_words.append(word)
                continue
                
            # Сохраняем оригинальный регистр слова
            original_word = word
            word_lower = word.lower()
            
            # Проверяем, есть ли слово в словаре
            if word_lower in TRANSLATION_DICT:
                translation = TRANSLATION_DICT[word_lower]
                
                # Если перевод пустой (например, для артиклей)
                if not translation:
                    continue
                    
                # Сохраняем оригинальный регистр
                if original_word.istitle() and translation:
                    translation = translation.capitalize()
                elif original_word.isupper() and translation:
                    translation = translation.upper()
                    
                translated_words.append(translation)
            else:
                # Если слово не найдено в словаре, оставляем его как есть
                translated_words.append(original_word)
                
        # Объединяем слова обратно в текст
        translated_text = ' '.join(translated_words)
        
        # Дополнительная очистка текста для лучшей читаемости
        # 1. Убираем пробелы перед знаками препинания
        translated_text = re.sub(r'\s+([.,!?;:])', r'\1', translated_text)
        
        # 2. Добавляем пробелы после знаков препинания, если за ними следует буква
        translated_text = re.sub(r'([.,!?;:])([а-яА-Яa-zA-Z])', r'\1 \2', translated_text)
        
        # 3. Исправляем двойные пробелы
        translated_text = re.sub(r'\s{2,}', ' ', translated_text)
        
        # 4. Правильное использование дефисов
        translated_text = re.sub(r'\s-\s', '-', translated_text)
        
        # 5. Правила для русского языка
        clean_patterns = [
            # Убираем "и" в начале предложения
            (r'^\s*И\s+', ''),
            (r'^\s*и\s+', ''),
            # Убираем ошибочные конструкции
            (r'\sявляется\s+был', ' был'),
            (r'\sявляется\s+были', ' были'),
            # Исправляем предлоги
            (r'\sв\s+в\s', ' в '),
            (r'\sна\s+на\s', ' на '),
            # Исправляем местоимения
            (r'\sего его\s', ' его '),
            (r'\sих их\s', ' их '),
        ]
        
        for pattern, replacement in clean_patterns:
            translated_text = re.sub(pattern, replacement, translated_text)
            
        logging.info(f"Translation result: {translated_text}")
        return translated_text
    except Exception as e:
        logging.error(f"Translation error: {str(e)}")
        # В случае ошибки возвращаем исходный текст
        return text

# Словарь для перевода - расширенный набор слов, особенно характерных для "Острова сокровищ"
TRANSLATION_DICT = {
    # Общие слова
    "the": "", "a": "", "an": "", "is": "является", "are": "являются", "was": "был", "were": "были",
    "am": "являюсь", "be": "быть", "been": "был", "will": "будет", "would": "бы", "should": "следует",
    "can": "может", "could": "мог бы", "may": "может", "might": "мог бы", "must": "должен",
    "have": "иметь", "has": "имеет", "had": "имел", "do": "делать", "does": "делает", "did": "делал",
    "in": "в", "on": "на", "at": "на", "by": "у", "with": "с", "from": "из", "of": "из", "to": "к",
    "for": "для", "about": "о", "against": "против", "between": "между", "into": "в", "through": "через",
    "during": "во время", "before": "перед", "after": "после", "above": "над", "below": "под",
    "up": "вверх", "down": "вниз", "out": "вне", "off": "от", "over": "над", "under": "под", "again": "снова",
    "further": "далее", "then": "затем", "once": "однажды", "here": "здесь", "there": "там", "when": "когда",
    "where": "где", "why": "почему", "how": "как", "all": "все", "any": "любой", "both": "оба", "each": "каждый",
    "few": "несколько", "more": "больше", "most": "большинство", "other": "другой", "some": "некоторые",
    "such": "такой", "no": "нет", "nor": "ни", "not": "не", "only": "только", "own": "собственный",
    "same": "тот же", "so": "так", "than": "чем", "too": "тоже", "very": "очень", "this": "это",
    "that": "то", "i": "я", "me": "меня", "my": "мой", "myself": "себя", "we": "мы", "our": "наш", "ours": "наш",
    "ourselves": "себя", "you": "ты", "your": "твой", "yours": "твой", "yourself": "себя", "yourselves": "себя",
    "he": "он", "him": "его", "his": "его", "himself": "себя", "she": "она", "her": "её", "hers": "её",
    "herself": "себя", "it": "это", "its": "его", "itself": "себя", "they": "они", "them": "их", "their": "их",
    "theirs": "их", "themselves": "себя", "what": "что", "which": "который", "who": "кто", "whom": "кого",
    "whose": "чей", "and": "и", "but": "но", "if": "если", "or": "или", "because": "потому что",
    "as": "как", "until": "до", "while": "пока", "said": "сказал", "one": "один", "two": "два", "three": "три",
    
    # Персонажи из Острова Сокровищ
    "jim": "Джим", "hawkins": "Хокинс", "trelawney": "Трелони", "squire": "сквайр",
    "doctor": "доктор", "livesey": "Ливси", "smollett": "Смоллетт", "captain": "капитан",
    "flint": "Флинт", "silver": "Сильвер", "john": "Джон", "long": "Долговязый", "ben": "Бен",
    "gunn": "Ганн", "black": "Чёрный", "dog": "Пёс", "blind": "слепой", "pew": "Пью",
    "israel": "Израэль", "hands": "Хендс", "billy": "Билли", "bones": "Бонс", "george": "Джордж",
    "merry": "Мерри", "tom": "Том", "morgan": "Морган", "dirk": "Дёрк", "joyce": "Джойс",
    "o'brien": "О'Брайен", "redruth": "Редрут", "blandly": "Блендли", "arrow": "Эрроу",
    
    # Морская терминология и термины из книги
    "sea": "море", "sailor": "моряк", "ship": "корабль", "boat": "лодка", "deck": "палуба",
    "mast": "мачта", "sail": "парус", "cabin": "каюта", "mate": "помощник", "crew": "команда",
    "pirate": "пират", "treasure": "сокровище", "map": "карта", "island": "остров", "beach": "пляж",
    "shore": "берег", "coast": "побережье", "water": "вода", "wave": "волна", "tide": "прилив",
    "port": "порт", "harbor": "гавань", "inn": "таверна", "rum": "ром", "chest": "сундук",
    "gold": "золото", "silver": "серебро", "coin": "монета", "cutlass": "абордажная сабля",
    "sword": "меч", "pistol": "пистолет", "gun": "ружье", "musket": "мушкет", "shot": "выстрел",
    "powder": "порох", "adventure": "приключение", "stockade": "частокол", "parrot": "попугай",
    "pieces of eight": "пиастры", "schooner": "шхуна", "rigging": "такелаж", "mutiny": "мятеж",
    "spy-glass": "подзорная труба", "anchor": "якорь", "voyage": "путешествие", "course": "курс",
    "wheel": "штурвал", "journal": "журнал", "log": "журнал", "buccaneers": "буканьеры",
    "hispaniola": "Испаньола", "jolly roger": "Весёлый Роджер", "maroon": "высадить на необитаемый остров",
    "black spot": "черная метка", "skeleton": "скелет", "compass": "компас", "cove": "бухта",
    "spyglass": "подзорная труба", "sail": "парус", "plunder": "добыча", "booty": "награбленное",
    
    # Дополнительные распространённые слова
    "good": "хороший", "bad": "плохой", "man": "человек", "woman": "женщина", "boy": "мальчик",
    "girl": "девочка", "child": "ребенок", "children": "дети", "friend": "друг", "enemy": "враг",
    "time": "время", "year": "год", "day": "день", "night": "ночь", "life": "жизнь", "world": "мир",
    "way": "путь", "thing": "вещь", "part": "часть", "place": "место", "case": "случай", "group": "группа",
    "company": "компания", "number": "число", "work": "работа", "point": "точка", "government": "правительство",
    "country": "страна", "city": "город", "house": "дом", "room": "комната", "area": "область",
    "issue": "проблема", "side": "сторона", "business": "бизнес", "school": "школа", "family": "семья",
    "word": "слово", "eye": "глаз", "head": "голова", "hand": "рука", "foot": "нога", "face": "лицо",
    "body": "тело", "heart": "сердце", "mind": "разум", "look": "смотреть", "see": "видеть", "find": "находить",
    "tell": "рассказывать", "ask": "спрашивать", "give": "давать", "take": "брать", "come": "приходить",
    "go": "идти", "get": "получать", "make": "делать", "know": "знать", "think": "думать", "want": "хотеть",
    "need": "нуждаться", "seem": "казаться", "feel": "чувствовать", "try": "пытаться", "leave": "уходить",
    "call": "звонить", "work": "работать", "move": "двигаться", "live": "жить", "believe": "верить",
    "hold": "держать", "bring": "приносить", "happen": "случаться", "write": "писать", "read": "читать",
    "sit": "сидеть", "stand": "стоять", "hear": "слышать", "walk": "ходить", "run": "бежать",
    "like": "нравиться", "love": "любить", "hate": "ненавидеть", "say": "говорить", "talk": "разговаривать",
    "eat": "есть", "drink": "пить", "sleep": "спать", "play": "играть", "small": "маленький",
    "large": "большой", "old": "старый", "young": "молодой", "new": "новый", "right": "правильный",
    "wrong": "неправильный", "high": "высокий", "low": "низкий", "early": "ранний", "late": "поздний",
    "yes": "да", "maybe": "возможно", "perhaps": "возможно", "always": "всегда", "never": "никогда",
    "sometimes": "иногда", "often": "часто", "really": "действительно", "actually": "на самом деле",
    "well": "хорошо", "great": "отлично", "pretty": "довольно", "little": "мало", "lot": "много",
    "first": "первый", "last": "последний", "next": "следующий", "same": "такой же",
}

# Инициализация приложения
@app.on_event("startup")
async def startup():
    init_db()

@app.post("/api/prepare-book")
async def prepare_book(
    request_data: PrepareBookRequest,  # Используем Pydantic модель
    current_user: User = Depends(get_current_user) # Используем стандартную зависимость
):
    # Удалены проверки токена из Cookie и получение user из токена
    # Данные получаем из request_data

    file_id = request_data.file_id
    english_text = request_data.english_text
    russian_text = request_data.russian_text

    if not file_id or not english_text or not russian_text:
        raise HTTPException(status_code=400, detail="Отсутствуют необходимые данные: file_id, english_text, russian_text")

    # Проверяем, что файл принадлежит пользователю
    conn = sqlite3.connect('app.db')
    c = conn.cursor()

    # Используем current_user["id"]
    c.execute("SELECT id FROM user_files WHERE id = ? AND user_id = ?", (file_id, current_user["id"]))
    file = c.fetchone()

    if not file:
        conn.close()
        raise HTTPException(status_code=404, detail="Файл не найден или у вас нет прав доступа к нему")

    # Создаем сопоставление между английским и русским текстом
    # Разбиваем текст на предложения и параграфы
    english_paragraphs = [p.strip() for p in english_text.split('\n\n') if p.strip()]
    russian_paragraphs = [p.strip() for p in russian_text.split('\n\n') if p.strip()]
    
    # Простой алгоритм сопоставления по порядку параграфов
    mapping = {}
    
    # Если разное количество параграфов, сопоставляем до минимального
    min_paragraphs = min(len(english_paragraphs), len(russian_paragraphs))
    
    for i in range(min_paragraphs):
        eng_para = english_paragraphs[i]
        rus_para = russian_paragraphs[i]
        
        # Словарь для каждого параграфа
        para_mapping = {
            "english": eng_para,
            "russian": rus_para
        }
        
        # Добавляем в общий словарь сопоставлений
        mapping[i] = para_mapping
    
    # Конвертируем словарь в JSON
    mapping_json = json.dumps(mapping, ensure_ascii=False)
    
    # Сохраняем сопоставление в базу данных
    try:
        # Проверяем, существует ли уже сопоставление для этого файла
        c.execute("SELECT id FROM files_with_mapping WHERE file_id = ?", (file_id,))
        existing_mapping = c.fetchone()
        
        if existing_mapping:
            # Обновляем существующее сопоставление
            c.execute("UPDATE files_with_mapping SET mapping_data = ?, created_at = CURRENT_TIMESTAMP WHERE file_id = ?", 
                      (mapping_json, file_id))
        else:
            # Создаем новое сопоставление
            c.execute("INSERT INTO files_with_mapping (file_id, mapping_data) VALUES (?, ?)",
                      (file_id, mapping_json))
        
        conn.commit()
    except Exception as e:
        conn.rollback()
        conn.close()
        raise HTTPException(status_code=500, detail=f"Ошибка сохранения сопоставления: {str(e)}")
    
    conn.close()
    
    return {"success": True, "message": "Книга успешно подготовлена"}

@app.get("/api/book-mapping/{filename}")
async def get_book_mapping(
    filename: str,
    current_user: User = Depends(get_current_user) # Используем стандартную зависимость
):
    # Удалены проверки токена из Cookie и получение user из токена

    # Проверяем, что файл принадлежит пользователю
    conn = sqlite3.connect('app.db')
    c = conn.cursor()

    # Используем current_user["id"]
    c.execute("SELECT id FROM user_files WHERE filename = ? AND user_id = ?", (filename, current_user["id"]))
    file = c.fetchone()

    if not file:
        conn.close()
        raise HTTPException(status_code=404, detail="Файл не найден или у вас нет прав доступа к нему")

    file_id = file[0]

    # Получаем сопоставление для файла
    c.execute("SELECT mapping_data FROM files_with_mapping WHERE file_id = ?", (file_id,))
    mapping_data = c.fetchone()

    if not mapping_data:
        conn.close()
        raise HTTPException(status_code=404, detail="Сопоставление для этого файла не найдено")
    
    conn.close()

    # Парсим JSON-данные из БД
    mapping = json.loads(mapping_data[0])

    return mapping

@app.get("/api/dictionary")
async def get_dictionary(current_user: User = Depends(get_current_user)):
    try:
        logger.info(f"Fetching dictionary for user_id: {current_user['id']}")
        
        with engine.connect() as conn:
            result = conn.execute(text("""
                SELECT id, word, translation, context, created_at 
                FROM user_dictionary 
                WHERE user_id = :user_id 
                ORDER BY created_at DESC
            """), {"user_id": current_user["id"]})
            
            # Преобразуем данные в формат, понятный клиенту
            words = []
            for row in result:
                try:
                    # Безопасное преобразование строк в JSON
                    entry = {
                        "id": row[0],
                        "word": str(row[1]) if row[1] is not None else "",
                        "translation": str(row[2]) if row[2] is not None else "",
                        "context": str(row[3]) if row[3] is not None else "",
                        "created_at": str(row[4]) if row[4] is not None else ""
                    }
                    words.append(entry)
                except Exception as row_error:
                    logger.error(f"Error processing dictionary row: {row_error}")
                    # Пропускаем проблемную запись и продолжаем
                    continue
            
            logger.info(f"Found {len(words)} dictionary entries")
            return {"words": words}
    except Exception as e:
        logger.error(f"Error fetching dictionary: {e}")
        return JSONResponse(
            status_code=500,
            content={"error": f"Internal server error: {str(e)}"}
        )

@app.post("/api/dictionary")
async def add_to_dictionary(
    word_data: dict,
    current_user: User = Depends(get_current_user)
):
    try:
        # Проверяем наличие обязательных полей
        if "word" not in word_data or "translation" not in word_data:
            logger.error(f"Missing required fields in dictionary entry: {word_data}")
            return JSONResponse(
                status_code=400,
                content={"error": "word and translation are required fields"}
            )
        
        # Получаем значения из запроса
        word = word_data.get("word", "").strip()
        translation = word_data.get("translation", "").strip()
        context = word_data.get("context", "")
        
        # Проверяем пустые значения
        if not word or not translation:
            logger.error(f"Empty word or translation in dictionary entry: {word_data}")
            return JSONResponse(
                status_code=400,
                content={"error": "word and translation cannot be empty"}
            )
        
        logger.info(f"Adding word to dictionary: {word} -> {translation} for user_id: {current_user['id']}")
        
        # Проверяем, нет ли уже такого слова в словаре
        with engine.connect() as conn:
            check_result = conn.execute(text("""
                SELECT id FROM user_dictionary 
                WHERE user_id = :user_id AND word = :word
            """), {
                "user_id": current_user["id"],
                "word": word
            })
            existing_word = check_result.fetchone()
            
            if existing_word:
                # Если слово уже есть, обновляем перевод и контекст
                logger.info(f"Word '{word}' already exists in dictionary, updating")
                conn.execute(text("""
                    UPDATE user_dictionary 
                    SET translation = :translation, context = :context 
                    WHERE user_id = :user_id AND word = :word
                """), {
                    "user_id": current_user["id"],
                    "word": word,
                    "translation": translation,
                    "context": context
                })
            else:
                # Добавляем новое слово
                conn.execute(text("""
                    INSERT INTO user_dictionary (user_id, word, translation, context)
                    VALUES (:user_id, :word, :translation, :context)
                """), {
                    "user_id": current_user["id"],
                    "word": word,
                    "translation": translation,
                    "context": context
                })
            
            conn.commit()
            
        return {"status": "success", "message": "Word added to dictionary"}
    except Exception as e:
        logger.error(f"Error adding word to dictionary: {e}")
        return JSONResponse(
            status_code=500,
            content={"error": f"Internal server error: {str(e)}"}
        )

@app.delete("/api/dictionary/{word_id}")
async def remove_from_dictionary(
    word_id: int,
    current_user: User = Depends(get_current_user)
):
    with engine.connect() as conn:
        conn.execute(text("""
            DELETE FROM user_dictionary 
            WHERE id = :word_id AND user_id = :user_id
        """), {
            "word_id": word_id,
            "user_id": current_user["id"]
        })
        conn.commit()
    return {"status": "success"}

@app.get("/api/dictionary/check")
async def check_word_in_dictionary(
    word: str,
    current_user: User = Depends(get_current_user)
):
    with engine.connect() as conn:
        result = conn.execute(text("""
            SELECT id FROM user_dictionary 
            WHERE user_id = :user_id AND word = :word
        """), {
            "user_id": current_user["id"],
            "word": word
        })
        exists = result.fetchone() is not None
    return {"exists": exists} 