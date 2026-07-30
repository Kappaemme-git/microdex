import { Redirect } from 'expo-router';

/**
 * Catch-all so a deep link can never leave the app on a dead end.
 *
 * A pairing link that Expo Router could not match used to land on the default
 * "Unmatched Route" screen, with no way back and the pairing code lost. Microdex
 * has a single real screen, and it reads the incoming URL itself, so anything
 * unmatched simply goes there: a valid pairing link is then handled normally,
 * and a wrong one just opens the app.
 */
export default function NotFoundScreen() {
  return <Redirect href="/" />;
}
