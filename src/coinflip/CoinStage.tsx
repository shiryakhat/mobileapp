/**
 * The website's 3D coin, in a WebView. The page is bundled with the app
 * (./page.ts), so it works offline. It takes no touches itself: the screen
 * lays a pressable over it and calls `toss()`.
 */
import { useImperativeHandle, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { coinPageHtml, parseCoinEvent, tossScript, type CoinStageProps } from './page';

// The class's own default for its extra props (`undefined`) leaves it with no props at all.
const Page = WebView<object>;
type PageRef = WebView<object>;

export function CoinStage({ still, onEvent, ref }: CoinStageProps) {
  const web = useRef<PageRef>(null);
  const source = useMemo(() => ({ html: coinPageHtml({ still }) }), [still]);

  useImperativeHandle(
    ref,
    () => ({ toss: (x) => web.current?.injectJavaScript(tossScript(x)) }),
    [],
  );

  const reload = () => web.current?.reload();

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Page
        ref={web}
        testID="coinflip-webview"
        source={source}
        originWhitelist={['*']}
        onMessage={(e) => {
          const event = parseCoinEvent(e.nativeEvent.data);
          if (event) onEvent(event);
        }}
        // The system may kill a WebView's process in the background: start over.
        onContentProcessDidTerminate={reload}
        onRenderProcessGone={reload}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        setSupportMultipleWindows={false}
        allowsLinkPreview={false}
        textInteractionEnabled={false}
        // Transparent until the page paints, so the navy screen shows instead of a white flash.
        style={styles.web}
        containerStyle={styles.web}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: 'transparent' },
});
