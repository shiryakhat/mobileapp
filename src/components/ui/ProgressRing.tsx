import type { ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

interface Props {
  /** 0–1; clamped. */
  value: number;
  /** Outer diameter. */
  size?: number;
  strokeWidth?: number;
  /** Colour of the arc. */
  color: string;
  /** Colour of the full circle the arc runs on. */
  trackColor: string;
  /** Fill of the disc inside the ring. */
  fill?: string;
  /** Centred inside the ring (an icon). */
  children?: ReactNode;
}

/**
 * Determinate circular progress: an arc that grows clockwise from 12 o'clock
 * around a round disc. Like every media progress in the app it runs the same
 * way in both layout directions.
 */
export function ProgressRing({
  value,
  size = 32,
  strokeWidth = 2.5,
  color,
  trackColor,
  fill = 'none',
  children,
}: Props) {
  const r = (size - strokeWidth) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const fraction = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={c} cy={c} r={r} fill={fill} stroke={trackColor} strokeWidth={strokeWidth} />
        {fraction > 0 ? (
          <Circle
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={[circumference, circumference]}
            strokeDashoffset={circumference * (1 - fraction)}
            // SVG circles start at 3 o'clock; turn the start to 12.
            transform={`rotate(-90 ${c} ${c})`}
          />
        ) : null}
      </Svg>
      {children}
    </View>
  );
}
