import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Easing,
  Pressable,
  SectionList,
  type SectionListProps,
  type SectionListRenderItem,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { RemoteThread } from '@/lib/bridge';
import { statusTone, type ThemePalette } from '@/lib/theme';

export type ChatDrawerHandle = {
  open: () => void;
  close: () => void;
};

type ChatDrawerProps = {
  activeThreadId: string | null;
  loadingAction: string | null;
  liveStatusPulse: Animated.Value;
  onArchive: (thread: RemoteThread) => void;
  onArchiveProject: (project: string, threads: RemoteThread[]) => void;
  onSelect: (threadId: string) => void;
  theme: ThemePalette;
  threads: RemoteThread[];
};

type ThreadSection = {
  project: string;
  collapsed: boolean;
  allThreads: RemoteThread[];
  data: RemoteThread[];
};

type DrawerScope = 'chats' | 'projects';

const ChatDrawer = memo(forwardRef<ChatDrawerHandle, ChatDrawerProps>(
  function ChatDrawer(
    {
      activeThreadId,
      loadingAction,
      liveStatusPulse,
      onArchive,
      onArchiveProject,
      onSelect,
      theme,
      threads,
    },
    ref,
  ) {
    const styles = useMemo(() => createStyles(theme), [theme]);
    const statusMeta = useMemo(() => statusTone(theme), [theme]);
    const insets = useSafeAreaInsets();
    const { width: viewportWidth } = useWindowDimensions();
    const drawerWidth = Math.min(viewportWidth * 0.86, 360);
    const [visible, setVisible] = useState(false);
    const [scope, setScope] = useState<DrawerScope>('chats');
    const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(
      () => new Set(),
    );
    const progress = useRef(new Animated.Value(0)).current;

    // Chats = flat list of every thread. Projects = same threads, grouped by folder.
    const chatThreads = useMemo(
      () => [...threads].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
      [threads],
    );

    const projectGroups = useMemo(() => {
      const groups = new Map<string, RemoteThread[]>();
      for (const thread of threads) {
        const project = thread.project?.trim() || 'General';
        const entries = groups.get(project) ?? [];
        entries.push(thread);
        groups.set(project, entries);
      }
      return [...groups.entries()]
        .map(([project, projectThreads]) => ({
          project,
          threads: [...projectThreads].sort(
            (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
          ),
        }))
        .sort((a, b) => a.project.localeCompare(b.project));
    }, [threads]);

    const projectSections = useMemo(
      () => projectGroups.map(({ project, threads: projectThreads }) => {
        const collapsed = collapsedProjects.has(project);
        return {
          project,
          collapsed,
          allThreads: projectThreads,
          data: collapsed ? [] : projectThreads,
        };
      }),
      [collapsedProjects, projectGroups],
    );

    const listSections = useMemo<ThreadSection[]>(() => {
      if (scope === 'chats') {
        if (!chatThreads.length) return [];
        return [{
          project: 'Chats',
          collapsed: false,
          allThreads: chatThreads,
          data: chatThreads,
        }];
      }
      return projectSections;
    }, [chatThreads, projectSections, scope]);

    const close = useCallback(() => {
      progress.stopAnimation();
      Animated.timing(progress, {
        toValue: 0,
        duration: 140,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setVisible(false);
      });
    }, [progress]);

    const open = useCallback(() => {
      progress.stopAnimation();
      progress.setValue(0);
      setVisible(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: 150,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      void Haptics.selectionAsync();
    }, [progress]);

    useImperativeHandle(ref, () => ({ open, close }), [close, open]);

    useEffect(() => {
      if (!visible) return undefined;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        close();
        return true;
      });
      return () => subscription.remove();
    }, [close, visible]);

    useEffect(() => {
      const activeProject = threads.find((thread) => thread.id === activeThreadId)?.project;
      if (!activeProject) return;
      setCollapsedProjects((current) => {
        if (!current.has(activeProject)) return current;
        const next = new Set(current);
        next.delete(activeProject);
        return next;
      });
    }, [activeThreadId, threads]);

    const toggleProject = useCallback((project: string) => {
      setCollapsedProjects((current) => {
        const next = new Set(current);
        if (next.has(project)) next.delete(project);
        else next.add(project);
        return next;
      });
      void Haptics.selectionAsync();
    }, []);

    const selectScope = useCallback((next: DrawerScope) => {
      setScope(next);
      void Haptics.selectionAsync();
    }, []);

    const keyExtractor = useCallback((thread: RemoteThread) => thread.id, []);
    const listHeader = useMemo(
      () => (
        <Text style={styles.sectionText}>
          {scope === 'chats'
            ? `All chats · ${chatThreads.length}`
            : `By project · ${projectGroups.length}`}
        </Text>
      ),
      [chatThreads.length, projectGroups.length, scope, styles],
    );
    const listEmpty = useMemo(
      () => (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No chats yet</Text>
          <Text style={styles.emptyBody}>
            When Codex has threads on your Mac, they show up here.
          </Text>
        </View>
      ),
      [styles],
    );
    const renderSectionFooter = useCallback(
      () => (scope === 'projects' ? <View style={styles.sectionGap} /> : null),
      [scope, styles],
    );
    const renderSectionHeader = useCallback<
      NonNullable<SectionListProps<RemoteThread, ThreadSection>['renderSectionHeader']>
    >(({ section }) => {
      if (scope === 'chats') return null;
      const archivingProject = loadingAction === `archive-project-${section.project}`;
      return (
        <View style={styles.projectHeaderRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${section.collapsed ? 'Show' : 'Hide'} chats in project ${section.project}`}
            accessibilityState={{ expanded: !section.collapsed }}
            onPress={() => toggleProject(section.project)}
            style={({ pressed }) => [
              styles.projectHeader,
              pressed && styles.projectHeaderPressed,
            ]}>
            <MaterialCommunityIcons
              name={section.collapsed ? 'folder-outline' : 'folder-open-outline'}
              size={16}
              color={theme.textMuted}
            />
            <Text style={styles.projectName} numberOfLines={1}>
              {section.project}
            </Text>
            <Text style={styles.projectCount}>{section.allThreads.length}</Text>
            <MaterialCommunityIcons
              name={section.collapsed ? 'chevron-right' : 'chevron-down'}
              size={16}
              color={theme.textFaint}
            />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Archive project ${section.project}`}
            disabled={archivingProject}
            onPress={() => onArchiveProject(section.project, section.allThreads)}
            hitSlop={6}
            style={({ pressed }) => [
              styles.projectArchive,
              pressed && styles.projectHeaderPressed,
            ]}>
            {archivingProject ? (
              <ActivityIndicator size="small" color={theme.danger} />
            ) : (
              <MaterialCommunityIcons
                name="folder-remove-outline"
                size={16}
                color={theme.textFaint}
              />
            )}
          </Pressable>
        </View>
      );
    }, [loadingAction, onArchiveProject, scope, styles, theme, toggleProject]);

    const renderItem = useCallback<
      SectionListRenderItem<RemoteThread, ThreadSection>
    >(({ item: thread, section }) => {
      const selected = thread.id === activeThreadId;
      const threadMeta = statusMeta[thread.status];
      return (
        <ReanimatedSwipeable
          friction={1.7}
          rightThreshold={38}
          overshootRight={false}
          renderRightActions={(_progress, _translation, swipeable) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Archive ${thread.name}`}
              disabled={loadingAction === `archive-${thread.id}`}
              onPress={() => {
                swipeable.close();
                onArchive(thread);
              }}
              style={styles.swipeArchive}>
              {loadingAction === `archive-${thread.id}` ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <MaterialCommunityIcons
                    name="tray-arrow-down"
                    size={17}
                    color="#FFFFFF"
                  />
                  <Text style={styles.swipeArchiveText}>ARCHIVE</Text>
                </>
              )}
            </Pressable>
          )}>
          <View style={[styles.chatRow, selected && styles.chatRowSelected]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                scope === 'projects'
                  ? `Open ${thread.name} in project ${section.project}`
                  : `Open chat ${thread.name}`
              }
              accessibilityHint={`Codex status: ${threadMeta.label}`}
              accessibilityState={{ selected }}
              disabled={loadingAction === 'select'}
              onPress={() => onSelect(thread.id)}
              style={({ pressed }) => [
                styles.chatRowOpen,
                pressed && styles.chatRowPressed,
              ]}>
              <Animated.View
                style={[
                  styles.chatDot,
                  { backgroundColor: threadMeta.color },
                  thread.status === 'thinking' && {
                    opacity: liveStatusPulse,
                    transform: [{
                      scale: liveStatusPulse.interpolate({
                        inputRange: [0.62, 1],
                        outputRange: [0.9, 1.15],
                      }),
                    }],
                  },
                ]}
              />
              <View style={styles.chatRowCopy}>
                <Text
                  style={[
                    styles.chatRowName,
                    selected && styles.chatRowNameSelected,
                  ]}
                  numberOfLines={1}>
                  {thread.name}
                </Text>
                <Text style={styles.chatRowTask} numberOfLines={1}>
                  {thread.task}
                </Text>
              </View>
            </Pressable>
          </View>
        </ReanimatedSwipeable>
      );
    }, [
      activeThreadId,
      liveStatusPulse,
      loadingAction,
      onArchive,
      onSelect,
      scope,
      statusMeta,
      styles,
    ]);

    return (
      <View
        accessibilityElementsHidden={!visible}
        importantForAccessibility={visible ? 'yes' : 'no-hide-descendants'}
        pointerEvents={visible ? 'auto' : 'none'}
        style={styles.modal}>
        <Animated.View
          style={[
            styles.scrim,
            {
              opacity: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 1],
              }),
            },
          ]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        </Animated.View>
        <Animated.View
          style={[
            styles.drawer,
            {
              width: drawerWidth,
              paddingTop: insets.top + 14,
              paddingBottom: Math.max(insets.bottom, 14),
              transform: [{
                translateX: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-drawerWidth, 0],
                }),
              }],
            },
          ]}>
          <View style={styles.header}>
            <Pressable
              accessibilityLabel="Close chat switcher"
              onPress={close}
              hitSlop={10}
              style={({ pressed }) => [styles.close, pressed && styles.closePressed]}>
              <MaterialCommunityIcons name="arrow-left" size={20} color={theme.text} />
            </Pressable>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Library</Text>
              <Text style={styles.syncText}>
                {threads.length} synced with Codex
              </Text>
            </View>
          </View>

          <View style={styles.scopeSegment}>
            {([
              { id: 'chats' as const, label: 'Chats', count: chatThreads.length },
              { id: 'projects' as const, label: 'Projects', count: projectGroups.length },
            ]).map((option) => {
              const active = scope === option.id;
              return (
                <Pressable
                  key={option.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => selectScope(option.id)}
                  style={[styles.scopeOption, active && styles.scopeOptionActive]}>
                  <Text style={[styles.scopeOptionText, active && styles.scopeOptionTextActive]}>
                    {option.label}
                  </Text>
                  <Text style={[styles.scopeOptionCount, active && styles.scopeOptionTextActive]}>
                    {option.count}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <SectionList
            style={styles.list}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
            sections={listSections}
            keyExtractor={keyExtractor}
            initialNumToRender={8}
            maxToRenderPerBatch={6}
            updateCellsBatchingPeriod={24}
            windowSize={5}
            stickySectionHeadersEnabled={false}
            ListHeaderComponent={listHeader}
            ListEmptyComponent={listEmpty}
            renderSectionFooter={renderSectionFooter}
            renderSectionHeader={renderSectionHeader}
            renderItem={renderItem}
          />
          <View style={styles.footer}>
            <Text style={styles.footerText}>Opens on your Mac</Text>
          </View>
        </Animated.View>
      </View>
    );
  },
));

ChatDrawer.displayName = 'ChatDrawer';

export default ChatDrawer;

function createStyles(theme: ThemePalette) {
  return StyleSheet.create({
    modal: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 100,
      elevation: 100,
    },
    scrim: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: theme.drawerScrim,
    },
    drawer: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      paddingHorizontal: 22,
      backgroundColor: theme.surface,
      borderTopRightRadius: 22,
      borderBottomRightRadius: 22,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      shadowColor: '#000000',
      shadowOffset: { width: 8, height: 0 },
      shadowOpacity: theme.mode === 'dark' ? 0.45 : 0.12,
      shadowRadius: 24,
      elevation: 18,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingBottom: 6,
    },
    headerCopy: { flex: 1, gap: 3 },
    title: {
      fontSize: 26,
      lineHeight: 30,
      fontWeight: '600',
      letterSpacing: -0.8,
      color: theme.text,
    },
    syncText: {
      fontSize: 13,
      fontWeight: '400',
      letterSpacing: -0.1,
      color: theme.textFaint,
    },
    close: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surfaceMuted,
    },
    closePressed: { opacity: 0.7 },
    scopeSegment: {
      marginTop: 14,
      marginBottom: 4,
      padding: 3,
      borderRadius: 999,
      backgroundColor: theme.surfaceMuted,
      flexDirection: 'row',
      gap: 2,
    },
    scopeOption: {
      flex: 1,
      minHeight: 36,
      borderRadius: 999,
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    scopeOptionActive: {
      backgroundColor: theme.surface,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: theme.mode === 'dark' ? 0.35 : 0.08,
      shadowRadius: 3,
      elevation: 1,
    },
    scopeOptionText: {
      fontSize: 13,
      fontWeight: '500',
      letterSpacing: -0.15,
      color: theme.textFaint,
    },
    scopeOptionCount: {
      fontSize: 12,
      fontWeight: '500',
      color: theme.textFaint,
    },
    scopeOptionTextActive: {
      color: theme.text,
      fontWeight: '600',
    },
    list: { flex: 1 },
    content: { paddingTop: 18, paddingBottom: 24, flexGrow: 1 },
    sectionText: {
      fontSize: 12,
      fontWeight: '500',
      letterSpacing: -0.1,
      color: theme.textFaint,
      marginBottom: 12,
    },
    emptyState: {
      marginTop: 36,
      paddingHorizontal: 8,
      alignItems: 'center',
      gap: 8,
    },
    emptyTitle: {
      fontSize: 16,
      fontWeight: '600',
      letterSpacing: -0.3,
      color: theme.text,
      textAlign: 'center',
    },
    emptyBody: {
      fontSize: 13,
      lineHeight: 19,
      letterSpacing: -0.1,
      color: theme.textFaint,
      textAlign: 'center',
    },
    sectionGap: { height: 22 },
    projectHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 2,
    },
    projectHeader: {
      flex: 1,
      minHeight: 36,
      paddingHorizontal: 2,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    projectHeaderPressed: { opacity: 0.55 },
    projectName: {
      flex: 1,
      fontSize: 14,
      fontWeight: '600',
      letterSpacing: -0.25,
      color: theme.text,
    },
    projectCount: {
      fontSize: 12,
      fontWeight: '500',
      color: theme.textFaint,
    },
    projectArchive: {
      width: 34,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chatRow: {
      minHeight: 58,
      marginBottom: 4,
      borderRadius: 14,
      overflow: 'hidden',
    },
    chatRowSelected: {
      backgroundColor: theme.surfaceMuted,
    },
    chatRowOpen: {
      flex: 1,
      minWidth: 0,
      paddingHorizontal: 12,
      paddingVertical: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    chatRowPressed: { opacity: 0.65 },
    chatDot: { width: 7, height: 7, borderRadius: 3.5 },
    chatRowCopy: { flex: 1, minWidth: 0 },
    chatRowName: {
      fontSize: 15,
      fontWeight: '500',
      letterSpacing: -0.2,
      color: theme.textMuted,
    },
    chatRowNameSelected: {
      fontWeight: '600',
      color: theme.text,
    },
    chatRowTask: {
      marginTop: 3,
      fontSize: 12,
      fontWeight: '400',
      letterSpacing: -0.1,
      color: theme.textFaint,
    },
    swipeArchive: {
      width: 78,
      marginBottom: 4,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      backgroundColor: theme.danger,
    },
    swipeArchiveText: {
      fontSize: 9,
      fontWeight: '600',
      letterSpacing: 0.4,
      color: '#FFFFFF',
    },
    footer: {
      minHeight: 44,
      paddingTop: 12,
      alignItems: 'center',
      justifyContent: 'center',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border,
    },
    footerText: {
      fontSize: 12,
      fontWeight: '400',
      letterSpacing: -0.1,
      color: theme.textFaint,
    },
  });
}
