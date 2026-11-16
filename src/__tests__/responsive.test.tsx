/**
 * Responsive layout: phones are untouched; tablets get a centred, capped
 * content column with modestly larger type.
 */
import { render, screen } from '@testing-library/react-native';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { Content, Text } from '@/components/ui';
import {
  breakpoints,
  layoutFor,
  MAX_CONTENT_WIDTH,
  scaleType,
  TABLET_GUTTER,
  type as typeScale,
} from '@/theme';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const setWidth = (width: number, height = 900) =>
  jest.mocked(useWindowDimensions).mockReturnValue({ width, height, scale: 2, fontScale: 1 });

describe('layoutFor', () => {
  it('is the identity on phones', () => {
    for (const width of [320, 390, 430, breakpoints.tablet - 1]) {
      expect(layoutFor(width)).toEqual({
        isTablet: false,
        isWide: false,
        contentWidth: width,
        gutter: 0,
        typeScale: 1,
        sizeScale: 1,
      });
    }
  });

  it('keeps a gutter on small tablets and unfolded foldables', () => {
    const fold = layoutFor(breakpoints.tablet);
    expect(fold.isTablet).toBe(true);
    expect(fold.contentWidth).toBe(breakpoints.tablet - 2 * TABLET_GUTTER);
    expect(fold.gutter).toBe(TABLET_GUTTER);

    const mini = layoutFor(744); // iPad mini, portrait
    expect(mini.contentWidth).toBe(696);
    expect(mini.isWide).toBe(false);
    expect(mini.typeScale).toBeGreaterThan(1);
  });

  it('caps and centres the column on full-size tablets', () => {
    for (const width of [820, 1024, 1366]) {
      const layout = layoutFor(width);
      expect(layout.contentWidth).toBe(MAX_CONTENT_WIDTH);
      expect(layout.gutter * 2 + layout.contentWidth).toBe(width);
    }
    expect(layoutFor(1024).isWide).toBe(true);
    expect(layoutFor(1024).typeScale).toBeGreaterThanOrEqual(layoutFor(744).typeScale);
  });

  it('scales type modestly, on whole points', () => {
    expect(scaleType(typeScale.body, 1)).toBe(typeScale.body);
    for (const width of [744, 1024]) {
      const scaled = scaleType(typeScale.body, layoutFor(width).typeScale);
      expect(Number.isInteger(scaled.fontSize)).toBe(true);
      expect(Number.isInteger(scaled.lineHeight)).toBe(true);
      expect(scaled.fontSize).toBeGreaterThan(typeScale.body.fontSize);
      expect(scaled.fontSize).toBeLessThanOrEqual(typeScale.body.fontSize * 1.2);
    }
  });
});

describe('<Content/> and <Text/>', () => {
  const show = async () => {
    await render(
      <Content testID="content">
        <Text testID="text">سلام</Text>
      </Content>,
    );
    return {
      content: StyleSheet.flatten(screen.getByTestId('content').props.style),
      text: StyleSheet.flatten(screen.getByTestId('text').props.style),
    };
  };

  it('changes nothing at phone widths', async () => {
    setWidth(390);
    const { content, text } = await show();
    expect(content).toEqual({ flex: 1 });
    expect(text).toMatchObject(typeScale.body);
  });

  it('centres a capped column with larger type on a tablet', async () => {
    setWidth(1024);
    const { content, text } = await show();
    expect(content).toEqual({
      flex: 1,
      width: '100%',
      maxWidth: MAX_CONTENT_WIDTH,
      alignSelf: 'center',
    });
    expect(text.fontSize).toBeGreaterThan(typeScale.body.fontSize);
  });
});
