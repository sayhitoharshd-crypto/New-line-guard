import { getApp } from "@react-native-firebase/app";
import { getAuth } from "@react-native-firebase/auth";
import { getFirestore } from "@react-native-firebase/firestore";

// The native Android SDK reads the default Firebase app from google-services.json.
// No client-side initialization object or service-account key is required.
export const firebaseApp = getApp();
export const firebaseAuth = getAuth(firebaseApp);
export const firestore = getFirestore(firebaseApp);
