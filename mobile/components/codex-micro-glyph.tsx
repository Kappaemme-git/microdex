import type { ReactNode } from 'react';
import Svg, {
  Circle,
  G,
  Path,
  Rect,
  Text as SvgText,
} from 'react-native-svg';

import { suggestedKeycapForCommand } from '@/lib/keycap-catalog';
import type { MicroKeycapId, ProgrammableCommandId } from '@/lib/programmed-keys';

type GlyphProps = {
  keycapId: MicroKeycapId;
  size?: number;
  color?: string;
};

type ActionGlyphProps = {
  actionId: string;
  size?: number;
  color?: string;
};

const strokeWidth = 2.15;

/**
 * Vector redraws of the legends shipped with Codex Micro.
 *
 * Work Louder publishes the keyset as product photography rather than reusable
 * SVG files, so these paths are traced for the app from the physical caps. They
 * deliberately share one rounded stroke system instead of mixing unrelated
 * icon fonts.
 */
export function CodexMicroGlyph({
  keycapId,
  size = 24,
  color = '#111719',
}: GlyphProps) {
  const glyph = glyphForKeycap(keycapId, color);

  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <G
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round">
        {glyph}
      </G>
    </Svg>
  );
}

export function CodexMicroActionGlyph({
  actionId,
  size = 22,
  color = '#111719',
}: ActionGlyphProps) {
  const keycapId =
    actionId === 'microdex.insertPrompt'
      ? 'MAGIC'
      : suggestedKeycapForCommand(actionId as ProgrammableCommandId) ?? 'MAGIC';
  return <CodexMicroGlyph keycapId={keycapId} size={size} color={color} />;
}

function glyphForKeycap(keycapId: MicroKeycapId, color: string): ReactNode {
  switch (keycapId) {
    // FAST, SPLIT e CODEX sono i tracciati originali di key-symbols.tsx, fatti
    // a mano per la prima versione dell'app. Erano giusti: sostituirli con una
    // rilettura della foto li ha peggiorati, quindi sono stati rimessi.
    case 'FAST':
      return <Path d="M18.7 2.8 7.2 17.1h7.6l-1.6 12.1 11.6-14.5h-7.6z" />;
    case 'APPR':
      return (
        <>
          <Circle cx="16" cy="16" r="11.4" />
          <Path d="m10.6 16.2 3.7 4.1 7.6-8.6" />
        </>
      );
    case 'REJ':
      return (
        <>
          <Circle cx="16" cy="16" r="11.4" />
          <Path d="m11.5 11.5 9 9m0-9-9 9" />
        </>
      );
    case 'SPLIT':
      // ExpandSymbol originale di key-symbols.tsx: un ramo entra da sinistra e
      // si apre in due, ciascuno con la propria punta a destra.
      return (
        <Path d="M4.5 16h7.2c5.3 0 5-8 10.3-8h5.3m-4.1-4.1L27.3 8l-4.1 4.1M11.7 16c5.3 0 5 8 10.3 8h5.3m-4.1-4.1 4.1 4.1-4.1 4.1" />
      );
    case 'MIC':
      return (
        <>
          <Rect x="12" y="4.5" width="8" height="16" rx="4" />
          <Path d="M8.5 16.2a7.5 7.5 0 0 0 15 0M16 23.7v4.3m-5 0h10" />
        </>
      );
    case 'CODEX':
      // Blob originale di CodexSymbol, riportato da viewBox 36 a 32, con il
      // prompt dentro: chevron e trattino, come sul cappuccio.
      return (
        <>
          <Path d="M9.1 9.9a6.2 6.2 0 0 1 7.1-4.4 5.5 5.5 0 0 1 6.3.6 5.4 5.4 0 0 1 3.4 5.5 6.2 6.2 0 0 1 0 8.9 5.5 5.5 0 0 1-3.5 6.6 5.5 5.5 0 0 1-8.1.7 6 6 0 0 1-7-5.8 5.9 5.9 0 0 1 1.8-12.1Z" />
          <Path d="m12.2 13.4 3.3 2.9-3.3 2.9m5.8 1h4.2" />
        </>
      );
    case 'BUG':
      return (
        <>
          <Rect x="10" y="9.5" width="12" height="15" rx="5.5" />
          <Path d="M13 9.5V7.2m6 2.3V7.2M7 13h3m12 0h3M6.5 19h3.5m12 0h3.5M8 25l3-2m13 2-3-2M13 15.3h6m-3-5.8v15" />
        </>
      );
    case 'OAI':
      return (
        <G transform="translate(2.5 2.5) scale(.084375)" fill={color} stroke="none">
          <Path d="m297.06 130.97c7.26-21.79 4.76-45.66-6.85-65.48-17.46-30.4-52.56-46.04-86.84-38.68C188.12 9.63 166.21-.14 143.24 0c-35.04-.08-66.13 22.48-76.91 55.82-22.51 4.61-41.94 18.7-53.31 38.67-17.59 30.32-13.58 68.54 9.92 94.54-7.26 21.79-4.76 45.66 6.85 65.48 17.46 30.4 52.56 46.04 86.84 38.68 15.24 17.18 37.16 26.95 60.13 26.8 35.06.09 66.16-22.49 76.94-55.86 22.51-4.61 41.94-18.7 53.31-38.67 17.57-30.32 13.55-68.51-9.94-94.51zm-120.28 168.11c-14.03.02-27.62-4.89-38.39-13.88.49-.26 1.34-.73 1.89-1.07l63.72-36.8c3.26-1.85 5.26-5.32 5.24-9.07v-89.83l26.93 15.55c.29.14.48.42.52.74v74.39c-.04 33.08-26.83 59.9-59.91 59.97zm-128.84-55.03c-7.03-12.14-9.56-26.37-7.15-40.18.47.28 1.3.79 1.89 1.13l63.72 36.8c3.23 1.89 7.23 1.89 10.47 0l77.79-44.92v31.1c.02.32-.13.63-.38.83l-64.41 37.19c-28.69 16.52-65.33 6.7-81.92-21.95zm-16.77-139.09c7-12.16 18.05-21.46 31.21-26.29 0 .55-.03 1.52-.03 2.2v73.61c-.02 3.74 1.98 7.21 5.23 9.06l77.79 44.91-26.93 15.55c-.27.18-.61.21-.91.08l-64.42-37.22c-28.63-16.58-38.45-53.21-21.95-81.89zm221.26 51.49-77.79-44.92 26.93-15.54c.27-.18.61-.21.91-.08l64.42 37.19c28.68 16.57 38.51 53.26 21.94 81.94-7.01 12.14-18.05 21.44-31.2 26.28v-75.81c.03-3.74-1.96-7.2-5.2-9.06zm26.8-40.34c-.47-.29-1.3-.79-1.89-1.13l-63.72-36.8c-3.23-1.89-7.23-1.89-10.47 0l-77.79 44.92v-31.1c-.02-.32.13-.63.38-.83l64.41-37.16c28.69-16.55 65.37-6.7 81.91 22 6.99 12.12 9.52 26.31 7.15 40.1zm-168.51 55.43-26.94-15.55c-.29-.14-.48-.42-.52-.74v-74.39c.02-33.12 26.89-59.96 60.01-59.94 14.01 0 27.57 4.92 38.34 13.88-.49.26-1.33.73-1.89 1.07l-63.72 36.8c-3.26 1.85-5.26 5.31-5.24 9.06l-.04 89.79zm14.63-31.54 34.65-20.01 34.65 20v40.01l-34.65 20-34.65-20z" />
        </G>
      );
    case 'TERM':
      return (
        <>
          <Rect x="4.5" y="6.5" width="23" height="19" rx="3.5" />
          <Path d="m9.5 12 4 4-4 4m7.2 0h5.8" />
        </>
      );
    case 'DWN':
      return <Path d="M16 4.5v14m-5-5 5 5 5-5M6.5 21.5v5h19v-5" />;
    case 'DEL':
      return (
        <>
          <Path d="M8 9.5h16M13 6h6l1 3.5M10.5 9.5l1.2 17h8.6l1.2-17M14 14v7.5m4-7.5v7.5" />
        </>
      );
    case 'NEW':
      return (
        <Path d="m12.2 19.8 8.7-8.7a4.2 4.2 0 1 1 6 6L15.7 28.3a7 7 0 0 1-9.9-9.9L17 7.2a4.8 4.8 0 0 1 6.8 6.8L13 24.8a2.7 2.7 0 0 1-3.8-3.8l9.2-9.2" />
      );
    case 'NAV':
      return <Path d="M4.5 14.2 27.5 5l-8.8 22-4.1-9-10.1-3.8Zm10.1 3.8L20 12.5" />;
    case 'MAGIC':
      return (
        <>
          <Path d="M11 4.5c.7 3.7 2.8 5.8 6.5 6.5-3.7.7-5.8 2.8-6.5 6.5-.7-3.7-2.8-5.8-6.5-6.5 3.7-.7 5.8-2.8 6.5-6.5Z" />
          <Path d="M22 15.5c.5 2.6 1.9 4 4.5 4.5-2.6.5-4 1.9-4.5 4.5-.5-2.6-1.9-4-4.5-4.5 2.6-.5 4-1.9 4.5-4.5Z" />
          <Path d="M25.5 5.5v4m-2-2h4" />
        </>
      );
    case 'DIFF':
      // Sul cappuccio e' una colonna di punti e trattini, non un documento.
      return (
        <>
          <Circle cx="11" cy="8" r="1.6" fill={color} stroke="none" />
          <Path d="M11 12.5v11" />
          <Circle cx="11" cy="26" r="1.6" fill={color} stroke="none" />
          <Circle cx="21" cy="12" r="1.6" fill={color} stroke="none" />
          <Circle cx="21" cy="20" r="1.6" fill={color} stroke="none" />
        </>
      );
    case 'PLAY':
      // Sul cappuccio il triangolo sta dentro un cerchio, non e' nudo.
      return (
        <>
          <Circle cx="16" cy="16" r="11.4" />
          <Path d="m13.2 10.8 8.4 5.2-8.4 5.2Z" />
        </>
      );
    case 'GIT':
      return (
        <>
          <Circle cx="10" cy="7" r="2.3" />
          <Circle cx="10" cy="25" r="2.3" />
          <Circle cx="23" cy="13" r="2.3" />
          <Path d="M10 9.3v13.4m0-8.5c5.5 0 7-1.2 10.8-4.3" />
        </>
      );
    case 'BRCH':
      return (
        <>
          <Circle cx="8" cy="7" r="2.2" />
          <Circle cx="24" cy="8" r="2.2" />
          <Circle cx="24" cy="24" r="2.2" />
          <Path d="M8 9.2v7c0 4.3 3.5 7.8 7.8 7.8h6M10.2 7h5.5c4.5 0 8.3 3.7 8.3 8.3v6.5" />
        </>
      );
    case 'BRANCH':
      return (
        <>
          <Circle cx="8" cy="7" r="2.2" />
          <Circle cx="8" cy="25" r="2.2" />
          <Path d="M8 9.2v13.6M10.2 15h7.3m5-4.5v9m-4.5-4.5h9" />
        </>
      );
    case 'MRG':
      return (
        <>
          <Circle cx="8" cy="7" r="2.2" />
          <Circle cx="24" cy="7" r="2.2" />
          <Circle cx="16" cy="25" r="2.2" />
          <Path d="M8 9.2v4c0 4.8 3.2 6 8 9.6M24 9.2v4c0 4.8-3.2 6-8 9.6" />
        </>
      );
    case 'PR':
      return (
        <>
          <Circle cx="8" cy="7" r="2.2" />
          <Circle cx="8" cy="25" r="2.2" />
          <Circle cx="24" cy="25" r="2.2" />
          <Path d="M8 9.2v13.6M15 7h3a6 6 0 0 1 6 6v9.8m-12-19L15 7l-3 3.2" />
        </>
      );
    case 'PAINT':
      return (
        <>
          <Path d="m6 21 13.5-13.5 5 5L11 26H6v-5Z" />
          <Path d="m17 10 5 5M6 26c0 1.5-1 2.5-2.5 2.5" />
        </>
      );
    case 'LAB':
      return (
        <>
          <Path d="M12 4.5h8M14 4.5v7L7.5 24.2A2.2 2.2 0 0 0 9.4 27h13.2a2.2 2.2 0 0 0 1.9-2.8L18 11.5v-7" />
          <Path d="M10.5 21h11M13 17.5h6" />
        </>
      );
    case 'PARTY':
      return (
        <>
          <Path d="m6 27 4.8-16.5L21.5 22 6 27Z" />
          <Path d="m10.5 12 9.5 9.5M21 5.5v4m-2-2h4M25.5 13.5l2-2M15.5 5.5l-2-2M26 20l2 1" />
        </>
      );
    case 'TIME':
      return (
        <>
          <Circle cx="16" cy="16" r="11" />
          <Path d="M16 9v7l4.5 3" />
        </>
      );
    // I due cappucci del cervello non portano ne' il piu' ne' il meno: sono un
    // cervello con le circonvoluzioni e uno diviso a meta'. Il piu' e il meno
    // erano un'aggiunta mia e non esistono sul prodotto.
    case 'MIND+':
      return (
        <>
          <Path d="M15.2 6.2a4.3 4.3 0 0 0-6.4 3.6 4.6 4.6 0 0 0-1.4 8.2 4.4 4.4 0 0 0 4.6 6.9 4.4 4.4 0 0 0 8.6-1.2V9.4a4.3 4.3 0 0 0-5.4-3.2Z" />
          <Path d="M16.8 6.2a4.3 4.3 0 0 1 6.4 3.6 4.6 4.6 0 0 1 1.4 8.2 4.4 4.4 0 0 1-4.6 6.9" />
          <Path d="M12.4 12.1c1.9.3 3 1.4 3.2 3.3m-4.4 3.4c1.9.2 3.1 1.3 3.4 3.2" />
        </>
      );
    case 'MIND-':
      return (
        <>
          <Path d="M15.2 6.2a4.3 4.3 0 0 0-6.4 3.6 4.6 4.6 0 0 0-1.4 8.2 4.4 4.4 0 0 0 4.6 6.9 4.4 4.4 0 0 0 3.2 1.3" />
          <Path d="M16.8 6.2a4.3 4.3 0 0 1 6.4 3.6 4.6 4.6 0 0 1 1.4 8.2 4.4 4.4 0 0 1-4.6 6.9 4.4 4.4 0 0 1-3.2 1.3" />
          <Path d="M16 5.9v20.1" />
        </>
      );
    case 'SETUP':
      return (
        <>
          <Circle cx="16" cy="16" r="4.2" />
          <Path d="M13.5 4.5h5l.8 3a10 10 0 0 1 2.2 1.3l3-.8 2.5 4.3-2.2 2.2a9.5 9.5 0 0 1 0 2.8l2.2 2.2-2.5 4.3-3-.8a10 10 0 0 1-2.2 1.3l-.8 3h-5l-.8-3a10 10 0 0 1-2.2-1.3l-3 .8L5 19.5l2.2-2.2a9.5 9.5 0 0 1 0-2.8L5 12.3 7.5 8l3 .8a10 10 0 0 1 2.2-1.3l.8-3Z" />
        </>
      );
    case 'FOLD':
      return (
        <>
          <Path d="M4.5 9.5h9l2.5 3h11.5v13h-23Z" />
          <Path d="M21 16v7m-3.5-3.5h7" />
        </>
      );
    case 'UPL':
      return (
        <>
          <Path d="M10 25H7.5a4.5 4.5 0 0 1-.6-9A7.7 7.7 0 0 1 22 13.5a5.5 5.5 0 0 1 2.5 10.4H22" />
          <Path d="M16 27V14m-4 4 4-4 4 4" />
        </>
      );
    case 'APPS':
      return (
        <>
          <Circle cx="10" cy="10" r="2.6" fill={color} stroke="none" />
          <Circle cx="22" cy="10" r="2.6" fill={color} stroke="none" />
          <Circle cx="10" cy="22" r="2.6" fill={color} stroke="none" />
          <Circle cx="22" cy="22" r="2.6" fill={color} stroke="none" />
        </>
      );
    case 'YOLO':
      return (
        <SvgText
          x="16"
          y="18.8"
          fill={color}
          stroke="none"
          fontSize="7.2"
          fontWeight="700"
          textAnchor="middle">
          yolo
        </SvgText>
      );
    case 'YEET':
      return (
        <SvgText
          x="16"
          y="18.8"
          fill={color}
          stroke="none"
          fontSize="7.2"
          fontWeight="700"
          textAnchor="middle">
          yeet
        </SvgText>
      );
    case 'EMPT1':
    case 'EMPT2':
    case 'EMPT3':
    case 'EMPT4':
    case 'EMPT5':
      return null;
  }
}
