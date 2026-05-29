// Firebase browser SDK wrapper.
// The rest of the app imports this module instead of touching Firebase APIs directly.
const SDK_VERSION = '12.7.0';

let firebaseState = {
    enabled: false,
    app: null,
    auth: null,
    db: null,
    authSdk: null,
    firestore: null
};

// Loads Firebase config from the local backend and initializes Auth + Firestore once.
export async function initFirebaseClient() {
    if (firebaseState.app) return firebaseState;

    const response = await fetch('/api/firebase-config');
    const payload = await response.json().catch(() => ({ enabled: false }));

    if (!payload.enabled || !payload.config) {
        firebaseState.enabled = false;
        return firebaseState;
    }

    const [{ initializeApp }, authSdk, firestore] = await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth.js`),
        import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`)
    ]);

    const app = initializeApp(payload.config);
    firebaseState = {
        enabled: true,
        app,
        auth: authSdk.getAuth(app),
        db: firestore.getFirestore(app),
        authSdk,
        firestore
    };

    return firebaseState;
}

// Used by pages to decide whether remote Firestore storage is available.
export function isFirebaseEnabled() {
    return firebaseState.enabled && Boolean(firebaseState.db);
}

// Returns the currently signed-in Firebase Auth user, if one exists.
export function getCurrentUser() {
    return firebaseState.auth?.currentUser || null;
}

// Lets the UI react when Firebase Auth signs a user in or out.
export function onAuthChange(callback) {
    if (!firebaseState.auth || !firebaseState.authSdk) return () => {};
    return firebaseState.authSdk.onAuthStateChanged(firebaseState.auth, callback);
}

// Creates the Firebase Auth account, then stores app profile metadata in Firestore.
export async function registerUser({ name, email, password }) {
    await initFirebaseClient();
    assertFirebase();

    const { createUserWithEmailAndPassword, updateProfile } = firebaseState.authSdk;
    const credential = await createUserWithEmailAndPassword(firebaseState.auth, email, password);
    await updateProfile(credential.user, { displayName: name });

    const now = new Date().toISOString();
    const profile = {
        uid: credential.user.uid,
        name,
        email: credential.user.email || email,
        bio: '',
        createdAt: now,
        lastLoginAt: now
    };

    await saveUserProfile(profile);
    await saveAccountLog({
        uid: profile.uid,
        name: profile.name,
        email: profile.email,
        event: '회원가입 완료',
        timestamp: now
    });

    return profile;
}

// Signs the user in and refreshes their Firestore profile login timestamp.
export async function loginUser({ email, password }) {
    await initFirebaseClient();
    assertFirebase();

    const { signInWithEmailAndPassword } = firebaseState.authSdk;
    const credential = await signInWithEmailAndPassword(firebaseState.auth, email, password);
    const existingProfile = await getUserProfile(credential.user.uid);
    const now = new Date().toISOString();
    const profile = {
        uid: credential.user.uid,
        name: existingProfile?.name || credential.user.displayName || credential.user.email || '사용자',
        email: credential.user.email || email,
        bio: existingProfile?.bio || '',
        createdAt: existingProfile?.createdAt || now,
        lastLoginAt: now
    };

    await saveUserProfile(profile);
    await saveAccountLog({
        uid: profile.uid,
        name: profile.name,
        email: profile.email,
        event: '로그인 성공',
        timestamp: now
    });

    return profile;
}

// Ends the Firebase Auth session in the browser.
export async function logoutUser() {
    await initFirebaseClient();
    if (!firebaseState.auth) return;
    await firebaseState.authSdk.signOut(firebaseState.auth);
}

// Sends Firebase's built-in password reset email.
export async function sendPasswordReset(email) {
    await initFirebaseClient();
    assertFirebase();
    await firebaseState.authSdk.sendPasswordResetEmail(firebaseState.auth, email);
}

// Saves the user profile document at users/{uid}; Auth stores the actual account.
export async function saveUserProfile(profile) {
    await initFirebaseClient();
    assertFirebase();

    const { doc, serverTimestamp, setDoc } = firebaseState.firestore;
    await setDoc(doc(firebaseState.db, 'users', profile.uid), {
        uid: profile.uid,
        name: profile.name || '사용자',
        email: profile.email || 'N/A',
        bio: profile.bio || '',
        createdAt: profile.createdAt || new Date().toISOString(),
        lastLoginAt: profile.lastLoginAt || new Date().toISOString(),
        updatedAt: serverTimestamp()
    }, { merge: true });

    return true;
}

// Updates display name and profile metadata for the logged-in user.
export async function updateUserProfile({ uid, name, bio }) {
    await initFirebaseClient();
    assertFirebase();

    const currentUser = getCurrentUser();
    if (currentUser && name && currentUser.displayName !== name) {
        await firebaseState.authSdk.updateProfile(currentUser, { displayName: name });
    }

    const existingProfile = await getUserProfile(uid);
    const profile = {
        uid,
        name,
        email: existingProfile?.email || currentUser?.email || 'N/A',
        bio,
        createdAt: existingProfile?.createdAt || new Date().toISOString(),
        lastLoginAt: existingProfile?.lastLoginAt || new Date().toISOString()
    };

    await saveUserProfile(profile);
    await saveAccountLog({
        uid,
        name: profile.name,
        email: profile.email,
        event: '프로필 업데이트',
        timestamp: new Date().toISOString()
    });

    return profile;
}

// Reads one user's profile metadata from Firestore.
export async function getUserProfile(uid) {
    await initFirebaseClient();
    if (!isFirebaseEnabled() || !uid) return null;

    const { doc, getDoc } = firebaseState.firestore;
    const snapshot = await getDoc(doc(firebaseState.db, 'users', uid));
    return snapshot.exists() ? snapshot.data() : null;
}

// Counts profile documents for the dashboard. Firestore rules may restrict this later.
export async function getUserCount() {
    await initFirebaseClient();
    if (!isFirebaseEnabled()) return 0;

    const { collection, getDocs } = firebaseState.firestore;
    const snapshot = await getDocs(collection(firebaseState.db, 'users'));
    return snapshot.size;
}

// Stores one search question and the hint/method answer shown to the user.
export async function saveSearchRecord(record) {
    await initFirebaseClient();
    assertFirebase();

    const { addDoc, collection, serverTimestamp } = firebaseState.firestore;
    await addDoc(collection(firebaseState.db, 'searchHistory'), {
        uid: record.uid || getCurrentUser()?.uid || '',
        question: record.question || '',
        answer: record.answer || '',
        name: record.name || 'Unknown',
        email: record.email || 'N/A',
        timestamp: record.timestamp || new Date().toISOString(),
        createdAt: serverTimestamp()
    });

    return true;
}

// Stores an account activity event such as signup, login, or profile update.
export async function saveAccountLog(record) {
    await initFirebaseClient();
    assertFirebase();

    const { addDoc, collection, serverTimestamp } = firebaseState.firestore;
    await addDoc(collection(firebaseState.db, 'accountLogs'), {
        uid: record.uid || getCurrentUser()?.uid || '',
        event: record.event || 'activity',
        name: record.name || 'Unknown',
        email: record.email || 'N/A',
        timestamp: record.timestamp || new Date().toISOString(),
        createdAt: serverTimestamp()
    });

    return true;
}

// Reads the latest search records for the current user or a supplied user context.
export async function getSearchRecords(userContext = {}) {
    await initFirebaseClient();
    if (!isFirebaseEnabled()) return null;

    const { collection, getDocs, limit, query, where } = firebaseState.firestore;
    const uid = typeof userContext === 'object'
        ? userContext.uid
        : getCurrentUser()?.uid;
    const normalizedEmail = typeof userContext === 'string'
        ? userContext.toLowerCase()
        : String(userContext.email || '').toLowerCase();
    const baseCollection = collection(firebaseState.db, 'searchHistory');
    const searchQuery = uid
        ? query(baseCollection, where('uid', '==', uid), limit(100))
        : normalizedEmail
        ? query(baseCollection, where('email', '==', normalizedEmail), limit(100))
        : query(baseCollection, limit(100));

    const snapshot = await getDocs(searchQuery);
    return snapshot.docs
        .map(doc => normalizeSearchRecord(doc.data(), doc.id))
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

// Deletes the user's saved search records from Firestore.
export async function clearSearchRecords(userContext = {}) {
    await initFirebaseClient();
    if (!isFirebaseEnabled()) return false;

    const { collection, deleteDoc, getDocs, limit, query, where } = firebaseState.firestore;
    const uid = typeof userContext === 'object'
        ? userContext.uid
        : getCurrentUser()?.uid;
    const normalizedEmail = typeof userContext === 'string'
        ? userContext.toLowerCase()
        : String(userContext.email || '').toLowerCase();
    const baseCollection = collection(firebaseState.db, 'searchHistory');
    const searchQuery = uid
        ? query(baseCollection, where('uid', '==', uid), limit(100))
        : normalizedEmail
        ? query(baseCollection, where('email', '==', normalizedEmail), limit(100))
        : query(baseCollection, limit(100));

    const snapshot = await getDocs(searchQuery);
    await Promise.all(snapshot.docs.map(doc => deleteDoc(doc.ref)));
    return true;
}

// Normalizes older local records and Firestore records into one shape for the UI.
function normalizeSearchRecord(data, id) {
    const createdAtDate = data.createdAt && typeof data.createdAt.toDate === 'function'
        ? data.createdAt.toDate()
        : null;

    return {
        id,
        uid: data.uid || '',
        question: data.question || data.query || '검색어 없음',
        answer: data.answer || '힌트 기록 없음',
        name: data.name || 'Unknown',
        email: data.email || 'N/A',
        timestamp: data.timestamp || (createdAtDate ? createdAtDate.toISOString() : new Date().toISOString())
    };
}

// Stops writes early when Firebase config is missing or failed to initialize.
function assertFirebase() {
    if (!isFirebaseEnabled()) {
        throw new Error('Firebase가 설정되어 있지 않습니다. /api/firebase-config와 Firebase 환경 변수를 확인해 주세요.');
    }
}
