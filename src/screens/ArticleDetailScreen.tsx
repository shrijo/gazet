import React, { useCallback, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Share,
  Linking,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useTheme } from '../theme';
import { Text, Icon } from '../components';
import { useAppStore } from '../hooks/useAppStore';
import { Article } from '../types';
import { formatArticleDate } from '../utils/date';

type RouteParams = { ArticleDetail: { article: Article } };

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function ArticleDetailScreen() {
  const { colors, spacing } = useTheme();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const route = useRoute<RouteProp<RouteParams, 'ArticleDetail'>>();
  const { article } = route.params;

  const { toggleBookmark } = useAppStore();
  const [isBookmarked, setIsBookmarked] = useState(article.isBookmarked);

  const bodyText = article.content?.trim().length
    ? stripHtml(article.content)
    : article.summary?.trim().length
      ? stripHtml(article.summary)
      : null;

  const handleBookmark = useCallback(async () => {
    const next = await toggleBookmark(article.id);
    setIsBookmarked(next);
  }, [article.id, toggleBookmark]);
  const handleShare    = useCallback(() => Share.share({ title: article.title, url: article.link }), [article]);
  const handleOpen     = useCallback(() => Linking.openURL(article.link), [article.link]);

  const meta = [
    article.feedTitle,
    article.author,
    article.pubDate ? formatArticleDate(article.pubDate) : null,
  ].filter(Boolean).join(' · ');

  const bottomBarHeight = 56 + insets.bottom;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Toolbar */}
      <View style={[styles.toolbar, { backgroundColor: colors.surface, paddingHorizontal: spacing[4], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
          <Icon name="arrow-back" size={24} color="secondary" />
        </TouchableOpacity>
        <View style={styles.toolbarRight}>
          <TouchableOpacity onPress={handleBookmark} hitSlop={8}>
            <Icon
              name={isBookmarked ? 'bookmark' : 'bookmark-outline'}
              size={22}
              color={isBookmarked ? 'primary' : 'secondary'}
            />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleShare} hitSlop={8} style={{ marginLeft: spacing[4] }}>
            <Icon name="share-outline" size={22} color="secondary" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomBarHeight + spacing[4] }]}
        showsVerticalScrollIndicator={false}
      >
        {article.imageUrl ? (
          <ExpoImage source={{ uri: article.imageUrl }} style={styles.hero} contentFit="cover" cachePolicy="disk" />
        ) : null}

        <View style={[styles.body, { paddingHorizontal: spacing[4] }]}>
          <Text variant="headingLg" style={styles.title}>{article.title}</Text>

          {meta ? (
            <Text variant="labelSm" color="tertiary" style={{ marginTop: spacing[2] }}>
              {meta}
            </Text>
          ) : null}

          {bodyText ? (
            <Text variant="bodyMd" color="secondary" style={{ marginTop: spacing[4], lineHeight: 26 }}>
              {bodyText}
            </Text>
          ) : (
            <Text variant="bodyMd" color="tertiary" style={{ marginTop: spacing[4] }}>
              No summary available.
            </Text>
          )}
        </View>
      </ScrollView>

      {/* Bottom bar */}
      <TouchableOpacity
        onPress={handleOpen}
        activeOpacity={0.8}
        style={[
          styles.bottomBar,
          {
            backgroundColor: colors.surface,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.border,
            paddingBottom: insets.bottom,
            height: bottomBarHeight,
          },
        ]}
      >
        <Icon name="open-outline" size={18} color="secondary" />
        <Text variant="labelMd" color="secondary" style={{ marginLeft: spacing[2] }}>
          Read full article
        </Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  toolbar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
  },
  toolbarRight: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  scroll: {
    paddingBottom: 48,
  },
  hero: {
    width: '100%',
    height: 220,
  },
  body: {
    paddingTop: 24,
  },
  title: {
    lineHeight: 32,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
