import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { addPublicDiscussionComment, appealPublicCase, listPublicDiscussion, reportPublicCase, type PublicDiscussionComment } from '@/lib/cases-api';

export default function PublicDiscussionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [comments, setComments] = useState<PublicDiscussionComment[]>([]);
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try { const result = await listPublicDiscussion(id); setComments(result.comments); }
    catch (e: any) { Alert.alert('Discussion unavailable', e?.message || 'This case discussion is unavailable.'); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const submit = async () => {
    if (!id || text.trim().length < 2 || busy) return;
    setBusy(true);
    try { const result = await addPublicDiscussionComment(id, text.trim()); setComments(prev => [...prev, result.comment]); setText(''); }
    catch (e: any) { Alert.alert('Could not post', e?.message || 'Please try again.'); }
    finally { setBusy(false); }
  };
  const submitReason = async (kind: 'report' | 'appeal') => {
    if (!id || reason.trim().length < 10 || busy) { Alert.alert('Add more detail', 'Please enter at least 10 characters.'); return; }
    setBusy(true);
    try { if (kind === 'report') await reportPublicCase(id, reason.trim()); else await appealPublicCase(id, reason.trim()); setReason(''); Alert.alert('Submitted', kind === 'report' ? 'The case is hidden pending human review.' : 'Your appeal was submitted for human review.'); }
    catch (e: any) { Alert.alert('Could not submit', e?.message || 'Please try again.'); }
    finally { setBusy(false); }
  };
  return <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: Platform.OS === 'web' ? 12 : insets.top }]}>
    <View style={styles.header}><Pressable onPress={() => router.back()}><Feather name="arrow-left" size={22} color={colors.foreground}/></Pressable><Text style={[styles.title, { color: colors.foreground }]}>Case discussion</Text><View style={{ width: 22 }}/></View>
    <Text style={[styles.note, { color: colors.mutedForeground }]}>Keep comments factual and respectful. Community comments and votes are not proof or a legal finding.</Text>
    {loading ? <ActivityIndicator color={colors.primary}/> : <FlatList data={comments} keyExtractor={item => item.id} contentContainerStyle={{ padding: 16, gap: 10 }} ListEmptyComponent={<Text style={{ color: colors.mutedForeground }}>No comments yet. Start a respectful discussion.</Text>} renderItem={({ item }) => <View style={[styles.comment, { backgroundColor: colors.card, borderColor: colors.border }]}><Text style={[styles.author, { color: colors.foreground }]}>{item.author}</Text><Text style={{ color: colors.foreground }}>{item.text}</Text><Text style={[styles.time, { color: colors.mutedForeground }]}>{item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}</Text></View>} />}
    <View style={[styles.composer, { borderColor: colors.border }]}><TextInput value={text} onChangeText={setText} placeholder="Write a comment…" placeholderTextColor={colors.mutedForeground} multiline maxLength={500} style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} /><Pressable disabled={busy || text.trim().length < 2} onPress={() => void submit()} style={[styles.action, { backgroundColor: colors.primary, opacity: busy || text.trim().length < 2 ? .5 : 1 }]}><Text style={{ color: '#fff', fontWeight: '700' }}>Post</Text></Pressable></View>
    <View style={[styles.review, { borderColor: colors.border }]}><Text style={[styles.section, { color: colors.foreground }]}>Request human review</Text><TextInput value={reason} onChangeText={setReason} placeholder="Explain the concern or appeal (10+ characters)" placeholderTextColor={colors.mutedForeground} multiline maxLength={1000} style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} /><View style={{ flexDirection: 'row', gap: 8 }}><Pressable disabled={busy} onPress={() => void submitReason('report')} style={[styles.action, { backgroundColor: '#B91C1C', opacity: busy ? .5 : 1 }]}><Text style={{ color: '#fff', fontWeight: '700' }}>Report case</Text></Pressable><Pressable disabled={busy} onPress={() => void submitReason('appeal')} style={[styles.action, { backgroundColor: colors.primary, opacity: busy ? .5 : 1 }]}><Text style={{ color: '#fff', fontWeight: '700' }}>Appeal</Text></Pressable></View></View>
  </View>;
}
const styles = StyleSheet.create({ screen: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 }, title: { fontSize: 18, fontWeight: '800' }, note: { paddingHorizontal: 16, fontSize: 12, lineHeight: 17 }, comment: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 5 }, author: { fontWeight: '700' }, time: { fontSize: 10 }, composer: { borderTopWidth: 1, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }, input: { flex: 1, borderWidth: 1, borderRadius: 10, padding: 10, maxHeight: 100 }, action: { paddingHorizontal: 14, paddingVertical: 11, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, review: { borderTopWidth: 1, padding: 12, gap: 8 }, section: { fontWeight: '800' } });
