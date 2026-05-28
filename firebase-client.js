const SDK_VERSION = '12.7.0';

let firebaseState = {
    enabled: false,
    app: null,
    db: null,
    storage: null,
    firestore: null
};

export async function initFirebaseClient() {
    if (firebaseState.app) return firebaseState;

    const response = await fetch('/api/firebase-config');
    const payload = await response.json().catch(() => ({ enabled: false }));

    if (!payload.enabled || !payload.config) {
        firebaseState.enabled = false;
        return firebaseState;
    }

    const [{ initializeApp }, firestore, { getStorage }] = await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`),
        import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-storage.js`)
    ]);

    const app = initializeApp(payload.config);
    firebaseState = {
        enabled: true,
        app,
        db: firestore.getFirestore(app),
        storage: getStorage(app),
        firestore
    };

    return firebaseState;
}

export function isFirebaseEnabled() {
    return firebaseState.enabled && Boolean(firebaseState.db);
}

export async function saveSearchRecord(record) {
    await initFirebaseClient();
    if (!isFirebaseEnabled()) return false;

    const { addDoc, collection, serverTimestamp } = firebaseState.firestore;
    await addDoc(collection(firebaseState.db, 'searchHistory'), {
        question: record.question || '',
        answer: record.answer || '',
        name: record.name || 'Unknown',
        email: record.email || 'N/A',
        timestamp: record.timestamp || new Date().toISOString(),
        createdAt: serverTimestamp()
    });

    return true;
}

export async function getSearchRecords(email) {
    await initFirebaseClient();
    if (!isFirebaseEnabled()) return null;

    const { collection, getDocs, limit, query, where } = firebaseState.firestore;
    const normalizedEmail = String(email || '').toLowerCase();
    const baseCollection = collection(firebaseState.db, 'searchHistory');
    const searchQuery = normalizedEmail
        ? query(baseCollection, where('email', '==', normalizedEmail), limit(100))
        : query(baseCollection, limit(100));

    const snapshot = await getDocs(searchQuery);
    return snapshot.docs
        .map(doc => normalizeRecord(doc.data(), doc.id))
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export async function clearSearchRecords(email) {
    await initFirebaseClient();
    if (!isFirebaseEnabled()) return false;

    const { collection, deleteDoc, getDocs, limit, query, where } = firebaseState.firestore;
    const normalizedEmail = String(email || '').toLowerCase();
    const baseCollection = collection(firebaseState.db, 'searchHistory');
    const searchQuery = normalizedEmail
        ? query(baseCollection, where('email', '==', normalizedEmail), limit(100))
        : query(baseCollection, limit(100));

    const snapshot = await getDocs(searchQuery);
    await Promise.all(snapshot.docs.map(doc => deleteDoc(doc.ref)));
    return true;
}

export function getStorageInstance() {
    return firebaseState.storage;
}

function normalizeRecord(data, id) {
    const createdAtDate = data.createdAt && typeof data.createdAt.toDate === 'function'
        ? data.createdAt.toDate()
        : null;

    return {
        id,
        question: data.question || data.query || '검색어 없음',
        answer: data.answer || '힌트 기록 없음',
        name: data.name || 'Unknown',
        email: data.email || 'N/A',
        timestamp: data.timestamp || (createdAtDate ? createdAtDate.toISOString() : new Date().toISOString())
    };
}
