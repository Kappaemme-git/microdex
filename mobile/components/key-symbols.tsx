import Svg, { Circle, Path } from 'react-native-svg';

export function LightningSymbol({ size = 32, color = '#111719' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Path
        d="M18.7 2.8L7.2 17.1H14.8L13.2 29.2L24.8 14.7H17.2L18.7 2.8Z"
        stroke={color}
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function ExpandSymbol({ size = 32, color = '#111719' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Path
        d="M5 16H10.5C15.5 16 15.2 8 20.5 8H26M22 4L26 8L22 12M10.5 16C15.5 16 15.2 24 20.5 24H26M22 20L26 24L22 28"
        stroke={color}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function CodexSymbol({ size = 34, color = '#111719' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 36 36" fill="none">
      <Path
        d="M10.2 11.1C11.1 7.4 14.6 5.1 18.2 6.2C21 4.6 24.6 6.1 25.3 9.4C29.2 10.1 30.9 14.4 28.7 17.6C30.1 21.2 27.6 24.9 23.9 25.1C21.9 28.4 17.3 28.9 14.8 25.9C10.9 26.6 7.8 23.3 8.8 19.5C5.7 17 6.4 12.3 10.2 11.1Z"
        stroke={color}
        strokeWidth="2.15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M13.2 15.6C14 14.3 15.5 13.5 17.1 13.7M19.8 21.4C18.4 22 16.8 21.7 15.7 20.7"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <Circle cx="21.8" cy="15.6" r="1.2" fill={color} />
    </Svg>
  );
}
