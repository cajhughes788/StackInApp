// /lib/auth.ts
// ------------------------------------------------------------
// Low-level Firebase auth wrapper
// Only signs the user out. ALL cleanup is done in auth-context.
// ------------------------------------------------------------
import { getAuthSafe } from "./firebase";
export async function logout() {
    try {
        const auth = getAuthSafe();
        if (auth)
            await auth.signOut();
    }
    catch (err) {
    }
}
