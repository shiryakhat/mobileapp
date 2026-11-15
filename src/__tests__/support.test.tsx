/**
 * Support / donate: the entry is bilingual, the donation goes to the Stripe
 * payment link, and iOS hands it to Safari instead of an in-app browser.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import { Linking, Platform } from 'react-native';
import { translate } from '@/i18n';
import { DONATE_URL, SUPPORT_URL, openDonation, openSupportSite } from '@/lib/support';
import { SupportSection } from '@/screens/SupportSection';
import { useSettings } from '@/state/settings';

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(() => Promise.resolve({ type: 'opened' })),
}));

const openBrowser = WebBrowser.openBrowserAsync as jest.Mock;
const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
let platform: { restore: () => void } | undefined;
const onPlatform = (os: typeof Platform.OS) => {
  platform = jest.replaceProperty(Platform, 'OS', os);
};

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  platform?.restore();
  platform = undefined;
});

describe('links', () => {
  it('donates through the Shir ya Khat Stripe payment link', () => {
    expect(DONATE_URL).toBe('https://buy.stripe.com/4gM00j82t10A2C1csI5c402');
  });

  it('points "other ways to support" at the Support us section of shiryakhat.net', () => {
    expect(SUPPORT_URL).toBe(
      'https://shiryakhat.net/#support:~:text=SUPPORT%20US%20%7C%20%D8%AD%D9%85%D8%A7%DB%8C%D8%AA%20%D8%A7%D8%B2%20%D9%85%D8%A7',
    );
    expect(decodeURIComponent(SUPPORT_URL)).toContain('SUPPORT US | حمایت از ما');
  });

  it('opens the donation in an in-app browser on Android', async () => {
    onPlatform('android');
    await openDonation();
    expect(openBrowser).toHaveBeenCalledWith(DONATE_URL, expect.any(Object));
    expect(openURL).not.toHaveBeenCalled();
  });

  it('leaves the app for the system browser on iOS (App Store rule for donations)', async () => {
    onPlatform('ios');
    await openDonation();
    expect(openBrowser).not.toHaveBeenCalled();
    expect(openURL).toHaveBeenCalledWith(DONATE_URL);
  });

  it('falls back to the system browser when no in-app browser is available', async () => {
    onPlatform('android');
    openBrowser.mockRejectedValueOnce(new Error('no browser'));
    await openDonation();
    expect(openURL).toHaveBeenCalledWith(DONATE_URL);
  });

  it('never throws, even with no browser at all', async () => {
    onPlatform('ios');
    openURL.mockRejectedValueOnce(new Error('nothing can open this'));
    await expect(openDonation()).resolves.toBeUndefined();
  });

  it('opens the website for other ways to support', async () => {
    await openSupportSite();
    expect(openURL).toHaveBeenCalledWith(SUPPORT_URL);
  });
});

describe.each(['fa', 'en'] as const)('<SupportSection/> in %s', (locale) => {
  beforeEach(() => useSettings.setState({ locale }));

  it('shows the localised entry and wires both actions', async () => {
    onPlatform('ios');
    await render(<SupportSection />);
    expect(screen.getByText(translate(locale, 'support'))).toBeTruthy();
    expect(screen.getByText(translate(locale, 'donate'))).toBeTruthy();
    expect(screen.getByText(translate(locale, 'otherWaysToSupport'))).toBeTruthy();

    await fireEvent.press(screen.getByTestId('donate-button'));
    expect(openURL).toHaveBeenLastCalledWith(DONATE_URL);
    await fireEvent.press(screen.getByTestId('support-site-link'));
    expect(openURL).toHaveBeenLastCalledWith(SUPPORT_URL);
  });
});

describe('Farsi labels', () => {
  it('uses the agreed wording', () => {
    expect(translate('fa', 'support')).toBe('حمایت از ما');
    expect(translate('fa', 'donate')).toBe('کمک مالی');
  });
});
