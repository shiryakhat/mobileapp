/**
 * Supporting the podcast: a Stripe payment link for donations and the
 * website's "Support us" section for everything else.
 */
import * as WebBrowser from 'expo-web-browser';
import { Linking, Platform } from 'react-native';
import { brand, dark } from '@/theme';

/** Stripe payment link of the "Shir ya Khat donation" product; the donor chooses the amount. */
export const DONATE_URL = 'https://buy.stripe.com/4gM00j82t10A2C1csI5c402';
/**
 * Other ways to support: the "SUPPORT US | حمایت از ما" section of the podcast's
 * website. The text fragment scrolls to (and highlights) that heading in
 * browsers that support it; the others simply land on `#support`.
 */
export const SUPPORT_URL =
  'https://shiryakhat.net/#support:~:text=SUPPORT%20US%20%7C%20%D8%AD%D9%85%D8%A7%DB%8C%D8%AA%20%D8%A7%D8%B2%20%D9%85%D8%A7';

async function openExternal(url: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch {
    // No browser to hand the link to; nothing sensible left to do.
  }
}

/**
 * Open the donation page.
 *
 * iOS leaves the app for Safari on purpose: App Store Review Guideline
 * 3.2.2 (iv) only lets apps that are not Apple-approved nonprofits collect
 * donations "outside of the app, such as via Safari". Everywhere else an
 * in-app browser tab keeps the listener one tap from where they were.
 */
export async function openDonation(): Promise<void> {
  if (Platform.OS !== 'ios') {
    try {
      await WebBrowser.openBrowserAsync(DONATE_URL, {
        toolbarColor: brand.navy,
        controlsColor: dark.accent,
        showTitle: true,
      });
      return;
    } catch {
      // No Custom Tabs-capable browser: fall through to the system handler.
    }
  }
  await openExternal(DONATE_URL);
}

export const openSupportSite = (): Promise<void> => openExternal(SUPPORT_URL);
