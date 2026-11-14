import { Redirect } from 'expo-router';
import { QuestionsScreen } from '@/community/QuestionsScreen';
import { communityEnabled } from '@/lib/flags';

export default function Questions() {
  if (!communityEnabled) return <Redirect href="/" />;
  return <QuestionsScreen />;
}
