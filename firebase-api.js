// firebase-api.js - Puente entre la app (app.js) y Firebase
// Expone window.FB con las operaciones que app.js usa.
// Se carga como módulo ES; inicializa la persistencia offline-first.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDUdHGFmBiLje4GAq1sSW9FEzTsmvk3sDA",
  authDomain: "micu-store.firebaseapp.com",
  projectId: "micu-store",
  storageBucket: "micu-store.firebasestorage.app",
  messagingSenderId: "171044380011",
  appId: "1:171044380011:web:b6d9fe526ae60a7759402e"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Instancia secundaria de Firebase, solo para crear usuarios sin afectar la sesion del admin
const secondaryApp = initializeApp(firebaseConfig, 'secondary');
const secondaryAuth = getAuth(secondaryApp);

// Firestore con caché persistente (offline-first multi-pestaña)
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

// Mensajes en español para errores comunes de Firebase Auth
function traducirAuthError(err) {
  const code = err.code || '';
  const map = {
    'auth/invalid-email': 'Correo electrónico inválido.',
    'auth/user-disabled': 'Usuario deshabilitado.',
    'auth/user-not-found': 'Usuario no encontrado.',
    'auth/wrong-password': 'Contraseña incorrecta.',
    'auth/invalid-credential': 'Correo o contraseña incorrectos.',
    'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos.',
    'auth/network-request-failed': 'Sin conexión. Verifica tu internet.',
    'auth/email-already-in-use': 'Ese correo ya está registrado.',
    'auth/weak-password': 'Contraseña muy débil (mínimo 6 caracteres).',
    'auth/requires-recent-login': 'Por seguridad, vuelve a iniciar sesión y reintenta.',
  };
  return map[code] || err.message || 'Error de autenticación.';
}

// Pequeños wrappers para imitar la API que ya usa app.js
window.FB = {
  app, auth, db,
  currentUser: null,            // { id, uid, email, nombre, rol, activo }
  isOnline: navigator.onLine,
  pendingWrites: 0,

  // ---------- AUTH ----------
  async signIn(email, password) {
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const profile = await this.get('usuarios', cred.user.uid);
      if (!profile) {
        await fbSignOut(auth);
        throw new Error('Sin perfil en base de datos. Pide al administrador que te dé acceso.');
      }
      if (profile.activo === false) {
        await fbSignOut(auth);
        throw new Error('Usuario desactivado. Contacta al administrador.');
      }
      this.currentUser = { id: cred.user.uid, uid: cred.user.uid, email: cred.user.email, ...profile };
      return this.currentUser;
    } catch (e) {
      throw new Error(traducirAuthError(e));
    }
  },

  async signOut() {
    await fbSignOut(auth);
    this.currentUser = null;
  },

  async createUserAndProfile({ email, password, nombre, rol }) {
    try {
      // Crear en Auth con la instancia secundaria (no afecta la sesion del admin)
      const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
      const newUid = cred.user.uid;
      // Cerrar la sesion del usuario nuevo en la instancia secundaria
      await fbSignOut(secondaryAuth);
      // El admin sigue logueado en la instancia principal, escribe el perfil en Firestore
      await setDoc(doc(db, 'usuarios', newUid), {
        id: newUid,
        nombre, rol, email,
        activo: true,
        creado: Date.now()
      });
      return newUid;
    } catch (e) {
      throw new Error(traducirAuthError(e));
    }
  },

  async changeMyPassword(passActual, passNueva) {
    try {
      const user = auth.currentUser;
      if (!user || !user.email) throw new Error('No hay sesión activa.');
      const credAct = EmailAuthProvider.credential(user.email, passActual);
      await reauthenticateWithCredential(user, credAct);
      await updatePassword(user, passNueva);
    } catch (e) {
      throw new Error(traducirAuthError(e));
    }
  },

  onAuth(callback) {
    return onAuthStateChanged(auth, async user => {
      if (!user) { this.currentUser = null; callback(null); return; }
      try {
        const profile = await this.get('usuarios', user.uid);
        if (!profile) { callback(null); return; }
        this.currentUser = { id: user.uid, uid: user.uid, email: user.email, ...profile };
        callback(this.currentUser);
      } catch (e) {
        console.error('Error cargando perfil:', e);
        callback(null);
      }
    });
  },

  // ---------- CRUD genérico ----------
  async getAll(coll) {
    // Movimientos: vendedor solo ve los suyos
    if (this.currentUser && this.currentUser.rol !== 'admin' && coll === 'movimientos') {
      const q = query(collection(db, coll), where('usuarioId', '==', this.currentUser.uid));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    // Ventas: todos los usuarios activos leen todas (necesario para ver créditos de otros usuarios)
    const snap = await getDocs(collection(db, coll));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async get(coll, id) {
    const snap = await getDoc(doc(db, coll, id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  },

  async put(coll, obj) {
    // Para 'config' la clave primaria es 'clave', para el resto es 'id'
    const key = coll === 'config' ? obj.clave : obj.id;
    if (!key) throw new Error('Falta id/clave para guardar en ' + coll);
    this.pendingWrites++;
    try {
      await setDoc(doc(db, coll, String(key)), obj, { merge: false });
    } finally {
      this.pendingWrites--;
      window.dispatchEvent(new CustomEvent('fb-pending', { detail: this.pendingWrites }));
    }
    return obj;
  },

  async del(coll, id) {
    this.pendingWrites++;
    try { await deleteDoc(doc(db, coll, String(id))); }
    finally {
      this.pendingWrites--;
      window.dispatchEvent(new CustomEvent('fb-pending', { detail: this.pendingWrites }));
    }
  },

  // ---------- Realtime (opcional, para futuras suscripciones) ----------
  subscribe(coll, callback, filter) {
    let q = collection(db, coll);
    if (filter) q = query(q, where(filter.field, filter.op, filter.value));
    return onSnapshot(q, snap => {
      callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }
};

// Estado online/offline para mostrar badge en la UI
window.addEventListener('online', () => {
  window.FB.isOnline = true;
  window.dispatchEvent(new CustomEvent('fb-connection', { detail: 'online' }));
});
window.addEventListener('offline', () => {
  window.FB.isOnline = false;
  window.dispatchEvent(new CustomEvent('fb-connection', { detail: 'offline' }));
});

// Señal de listo para que app.js arranque
window.dispatchEvent(new CustomEvent('fb-ready'));
console.log('Firebase API lista - proyecto:', firebaseConfig.projectId);
