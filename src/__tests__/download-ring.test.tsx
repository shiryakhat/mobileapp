/**
 * A download in flight shows its live progress (bytesWritten / totalBytes) as
 * a ring around the round control; paused and failed downloads stay distinct.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { DownloadButton, downloadFraction } from '@/components/DownloadButton';
import { ProgressRing } from '@/components/ui';
import { episodes } from '@/content';
import { translate } from '@/i18n';
import { pauseDownload, resumeDownload, useDownloads, type DownloadItem } from '@/state/downloads';
import { useSettings } from '@/state/settings';

jest.mock('expo-file-system', () => ({
  File: class {},
  Directory: class {},
  DownloadTask: class {},
  Paths: {},
}));
jest.mock('@/state/downloads', () => ({
  ...jest.requireActual('@/state/downloads'),
  pauseDownload: jest.fn(() => Promise.resolve()),
  resumeDownload: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useSettings.setState({ locale: 'en' });
  useDownloads.setState({ items: {} });
});

describe('download progress ring', () => {
  const episode = episodes.find((e) => e.audioUrl)!;
  const seed = (patch: Partial<DownloadItem>) =>
    useDownloads.setState({
      items: {
        [episode.id]: {
          episodeId: episode.id,
          status: 'downloading',
          bytesWritten: 0,
          totalBytes: 0,
          updatedAt: 0,
          ...patch,
        },
      },
    });
  const now = () => screen.getByTestId('download-progress').props.accessibilityValue.now;

  it('computes the fraction from bytesWritten / totalBytes, safely', () => {
    expect(downloadFraction({ bytesWritten: 25, totalBytes: 100 })).toBe(0.25);
    expect(downloadFraction({ bytesWritten: 10, totalBytes: 0 })).toBe(0);
    expect(downloadFraction({ bytesWritten: 150, totalBytes: 100 })).toBe(1);
  });

  it('draws an arc as long as the progress', async () => {
    const { toJSON } = await render(
      <ProgressRing value={0.25} size={32} strokeWidth={2} color="gold" trackColor="grey" />,
    );
    const circumference = 2 * Math.PI * 15;
    const tree = JSON.stringify(toJSON());
    expect(tree).toContain(String(circumference * 0.75)); // dash offset = what is left
  });

  it('shows live progress while downloading and pauses on tap', async () => {
    seed({ bytesWritten: 30, totalBytes: 120 });
    await render(<DownloadButton episode={episode} />);
    expect(now()).toBe(25);
    expect(screen.getByLabelText(translate('en', 'downloading'))).toBeTruthy();

    await fireEvent.press(screen.getByTestId('download-progress'));
    expect(pauseDownload).toHaveBeenCalledWith(episode.id);
  });

  it('keeps the progress when paused and resumes on tap', async () => {
    seed({ status: 'paused', bytesWritten: 60, totalBytes: 120 });
    await render(<DownloadButton episode={episode} />);
    expect(now()).toBe(50);

    await fireEvent.press(screen.getByLabelText(translate('en', 'resume')));
    expect(resumeDownload).toHaveBeenCalledWith(episode);
  });

  it('still shows the error state, without a ring', async () => {
    seed({ status: 'error' });
    await render(<DownloadButton episode={episode} />);
    expect(screen.getByLabelText(translate('en', 'retry'))).toBeTruthy();
    expect(screen.queryByTestId('download-progress')).toBeNull();
  });
});
