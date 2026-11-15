import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { syncBookmarks } from '@/community/api';
import { displayName, signInWithGitHub, signOut, useSession } from '@/community/auth';
import { StorageSettings } from '@/components/StorageSettings';
import { Button, SectionTitle, Segmented, Text } from '@/components/ui';
import { useI18n } from '@/i18n';
import { communityEnabled } from '@/lib/flags';
import { useSettings } from '@/state/settings';
import { radius, space, useTheme } from '@/theme';

function Group({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <SectionTitle>{title}</SectionTitle>
      <View
        style={{
          padding: space.md,
          gap: space.md,
          borderRadius: radius.md,
          backgroundColor: theme.surface,
          borderWidth: 1,
          borderColor: theme.line,
        }}
      >
        {children}
      </View>
    </View>
  );
}

function Community() {
  const { t } = useI18n();
  const session = useSession();
  const [status, setStatus] = useState<string>();
  const run = (job: () => Promise<unknown>, ok?: string) => {
    setStatus(undefined);
    job()
      .then(() => setStatus(ok))
      .catch((e: Error) => setStatus(e.message));
  };
  return (
    <Group title={t('community')}>
      {session ? (
        <>
          <Text>{t('signedInAs', { name: displayName(session) })}</Text>
          <Button
            kind="secondary"
            icon="help-circle"
            label={t('questions')}
            onPress={() => router.push('/questions')}
          />
          <Button
            kind="secondary"
            icon="refresh-cw"
            label={t('syncBookmarks')}
            onPress={() => run(syncBookmarks, t('synced'))}
          />
          <Button kind="ghost" icon="log-out" label={t('signOut')} onPress={() => run(signOut)} />
        </>
      ) : (
        <>
          <Button icon="github" label={t('signInGithub')} onPress={() => run(signInWithGitHub)} />
          <Button
            kind="secondary"
            icon="help-circle"
            label={t('questions')}
            onPress={() => router.push('/questions')}
          />
        </>
      )}
      {status ? (
        <Text variant="small" color="muted">
          {status}
        </Text>
      ) : null}
    </Group>
  );
}

export function SettingsTab() {
  const { t } = useI18n();
  const locale = useSettings((s) => s.locale);
  const setLocale = useSettings((s) => s.setLocale);
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl }}>
      <Text variant="title">{t('settings')}</Text>

      <Group title={t('language')}>
        <Segmented
          value={locale}
          onChange={setLocale}
          options={[
            { value: 'fa', label: 'فارسی' },
            { value: 'en', label: 'English' },
          ]}
        />
      </Group>

      <Group title={t('appearance')}>
        <Segmented
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'dark', label: t('themeDark') },
            { value: 'light', label: t('themeLight') },
            { value: 'system', label: t('themeSystem') },
          ]}
        />
      </Group>

      <Group title={t('storage')}>
        <StorageSettings />
      </Group>

      {communityEnabled ? (
        <Community />
      ) : (
        <Group title={t('community')}>
          <Text variant="small" color="muted">
            {t('communityOff')}
          </Text>
        </Group>
      )}

      <Group title={t('aboutApp')}>
        <Text variant="small" color="muted">
          {t('aboutBody')}
        </Text>
        <Button
          kind="secondary"
          icon="external-link"
          label={t('website')}
          onPress={() => void Linking.openURL('https://shiryakhat.net')}
        />
        <Text variant="micro" color="faint" align="center">
          {t('version', { v: Constants.expoConfig?.version ?? '1.0.0' })}
        </Text>
      </Group>
    </ScrollView>
  );
}
