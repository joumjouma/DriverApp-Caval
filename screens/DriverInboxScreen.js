import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Image,
  ActivityIndicator,
  Alert,
  StatusBar,
  SafeAreaView,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { collection, query, where, orderBy, onSnapshot, addDoc, serverTimestamp, doc, updateDoc, getDocs, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { auth } from '../config/firebase';

import { useTheme, makeStyles } from "../context/ThemeContext";
import { t } from "../utils/i18n";
const formatMessageTime = (timestamp) => {
  if (!timestamp || !timestamp.toDate) return '';
  
  try {
    const date = timestamp.toDate();
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);
    
    if (diffInSeconds < 60) {
      return 'just now';
    } else if (diffInSeconds < 3600) {
      const minutes = Math.floor(diffInSeconds / 60);
      return `${minutes}m ago`;
    } else if (diffInSeconds < 86400) {
      const hours = Math.floor(diffInSeconds / 3600);
      return `${hours}h ago`;
    } else {
      return date.toLocaleDateString([], { 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  } catch (error) {
    console.error('Error formatting timestamp:', error);
    return '';
  }
};

const DriverInboxScreen = () => {
  const { colors } = useTheme();
  const styles = useStyles();
  const route = useRoute();
  const navigation = useNavigation();
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const flatListRef = useRef(null);
  const { conversationId, customerName, customerPhoto } = route.params;
  const [customerPhotoUrl, setCustomerPhotoUrl] = useState(customerPhoto);

  useEffect(() => {
    const currentUser = auth.currentUser;

    if (!conversationId || !currentUser) {
      setLoading(false);
      setError('Unable to load conversation');
      return;
    }

    // Get conversation details including customer photo
    const getConversationDetails = async () => {
      try {
        const conversationRef = doc(db, 'conversations', conversationId);
        const conversationDoc = await getDoc(conversationRef);
        if (conversationDoc.exists()) {
          const data = conversationDoc.data();
          // Store customer photo URL in state
          if (data.customerPhoto) {
            setCustomerPhotoUrl(data.customerPhoto);
          }
        }
      } catch (error) {
        console.error('Error fetching conversation details:', error);
      }
    };

    getConversationDetails();

    // Query messages for this conversation
    const messagesRef = collection(db, 'conversations', conversationId, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'asc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const messageList = [];
      snapshot.forEach((doc) => {
        messageList.push({ id: doc.id, ...doc.data() });
      });
      setMessages(messageList);
      setLoading(false);
      setError(null);

      // Scroll to bottom when new messages arrive
      if (flatListRef.current && messageList.length > 0) {
        setTimeout(() => {
          flatListRef.current.scrollToEnd({ animated: true });
        }, 100);
      }
    }, (error) => {
      console.error('Error fetching messages:', error);
      setError('Failed to load messages');
      setLoading(false);
    });

    // Mark conversation as read for driver
    const markAsRead = async () => {
      try {
        const conversationRef = doc(db, 'conversations', conversationId);
        await updateDoc(conversationRef, {
          'readBy.driver': true,
          updatedAt: serverTimestamp()
        });
      } catch (error) {
        console.error('Error marking conversation as read:', error);
      }
    };

    markAsRead();

    return () => unsubscribe();
  }, [conversationId]);

  const sendMessage = async () => {
    if (!newMessage.trim() || sending) return;

    try {
      setSending(true);
      const currentUser = auth.currentUser;

      if (!currentUser) {
        throw new Error('No authenticated user found');
      }

      // Add message to conversation
      const messagesRef = collection(db, 'conversations', conversationId, 'messages');
      const messageRef = await addDoc(messagesRef, {
        text: newMessage.trim(),
        senderId: currentUser.uid,
        senderType: 'driver',
        timestamp: serverTimestamp(),
        status: 'sending'
      });

      // Update message status to sent
      await updateDoc(doc(db, 'conversations', conversationId, 'messages', messageRef.id), {
        status: 'sent'
      });

      // Update conversation's last message
      const conversationRef = doc(db, 'conversations', conversationId);
      await updateDoc(conversationRef, {
        lastMessage: newMessage.trim(),
        lastMessageTime: serverTimestamp(),
        lastMessageSender: currentUser.uid,
        lastSenderType: 'driver',
        updatedAt: serverTimestamp(),
        'readBy.customer': false
      });

      setNewMessage('');
      setError(null);
    } catch (error) {
      console.error('Error sending message:', error);
      setError('Failed to send message');
      Alert.alert('Error', 'Failed to send message. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const renderMessage = ({ item }) => {
    const currentUser = auth.currentUser;
    const isDriver = item.senderId === currentUser.uid;
    const formattedTime = formatMessageTime(item.timestamp);

    return (
      <View style={[
        styles.messageContainer,
        isDriver ? styles.driverMessage : styles.customerMessage
      ]}>
        {!isDriver && (
          customerPhotoUrl ? (
            <Image
              source={{ uri: customerPhotoUrl }}
              style={styles.avatar}
            />
          ) : (
            <View style={[styles.avatar, styles.defaultAvatar]}>
              <Ionicons name="person" size={24} color={colors.text} />
            </View>
          )
        )}
        <View style={[
          styles.messageBubble,
          isDriver ? styles.driverBubble : styles.customerBubble
        ]}>
          <Text style={[styles.messageText, isDriver && { color: colors.onPrimary }]}>{item.text}</Text>
          <View style={styles.messageFooter}>
            <Text style={[styles.timestamp, isDriver && { color: colors.onPrimaryMuted }]}>{formattedTime}</Text>
            {isDriver && (
              <Ionicons
                name={item.status === 'sending' ? 'time' : 'checkmark-done'}
                size={16}
                color={item.status === 'sent' ? colors.success : colors.textMuted}
                style={styles.statusIcon}
              />
            )}
          </View>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.info} />
          <Text style={styles.loadingText}>{t("Chargement de la conversation…")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 20}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity 
            style={styles.backButton} 
            onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerInfo}>
            {customerPhotoUrl ? (
              <Image
                source={{ uri: customerPhotoUrl }}
                style={styles.headerAvatar}
              />
            ) : (
              <View style={[styles.headerAvatar, styles.defaultHeaderAvatar]}>
                <Ionicons name="person" size={24} color={colors.text} />
              </View>
            )}
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerName}>{customerName || 'Customer'}</Text>
              <Text style={styles.onlineStatus}>{t("En ligne")}</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.moreButton}>
            <Ionicons name="ellipsis-vertical" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        {error && (
          <View style={styles.errorContainer}>
            <Ionicons name="alert-circle" size={16} color={colors.text} style={styles.errorIcon} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Messages List */}
        <View style={styles.messagesContainer}>
          <FlatList
            ref={flatListRef}
            data={messages}
            renderItem={renderMessage}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messagesList}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
            onLayout={() => flatListRef.current?.scrollToEnd()}
            showsVerticalScrollIndicator={false}
          />
        </View>

        {/* Message Input */}
        <View style={styles.inputContainer}>
          <TouchableOpacity style={styles.attachButton}>
            <Ionicons name="attach" size={24} color={colors.textMuted} />
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            value={newMessage}
            onChangeText={setNewMessage}
            placeholder={t("Écrivez un message…")}
            placeholderTextColor={colors.placeholder}
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            style={[styles.sendButton, (!newMessage.trim() || sending) && styles.sendButtonDisabled]}
            onPress={sendMessage}
            disabled={!newMessage.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Ionicons name="send" size={20} color={colors.onPrimary} />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const useStyles = makeStyles((colors) => ({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Platform.OS === 'android' ? 6 : 12,
    paddingHorizontal: 16,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    marginTop: Platform.OS === 'android' ? 32 : 0,
  },
  backButton: {
    padding: 4,
  },
  moreButton: {
    padding: 4,
  },
  headerInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 12,
  },
  headerTextContainer: {
    marginLeft: 12,
  },
  headerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  defaultHeaderAvatar: {
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerName: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '600',
  },
  onlineStatus: {
    color: colors.primaryText,
    fontSize: 12,
    marginTop: 2,
  },
  messagesContainer: {
    flex: 1,
    marginBottom: Platform.OS === 'android' ? 4 : 16,
  },
  messagesList: {
    paddingTop: Platform.OS === 'android' ? 6 : 16,
    paddingBottom: Platform.OS === 'android' ? 6 : 16,
    paddingHorizontal: 16,
  },
  messageContainer: {
    flexDirection: 'row',
    marginBottom: 20,
    alignItems: 'flex-end',
  },
  driverMessage: {
    justifyContent: 'flex-end',
  },
  customerMessage: {
    justifyContent: 'flex-start',
  },
  avatarContainer: {
    marginRight: 8,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  defaultAvatar: {
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  messageBubble: {
    maxWidth: '75%',
    padding: 12,
    borderRadius: 18,
    elevation: 1,
  },
  driverBubble: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  customerBubble: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 4,
  },
  messageText: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
  },
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 6,
  },
  timestamp: {
    color: colors.textMuted,
    fontSize: 11,
  },
  statusIcon: {
    marginLeft: 4,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Platform.OS === 'android' ? 6 : 12,
    paddingBottom: Platform.OS === 'ios' ? 24 : (Platform.OS === 'android' ? 48 : 12),
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    position: 'relative',
    bottom: 0,
    left: 0,
    right: 0,
  },
  attachButton: {
    marginRight: 8,
    padding: 4,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 16,
    marginRight: 10,
    maxHeight: 120,
  },
  sendButton: {
    backgroundColor: colors.primary,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: colors.primarySoft,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: colors.text,
    marginTop: 12,
    fontSize: 16,
  },
  errorContainer: {
    backgroundColor: colors.error,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorIcon: {
    marginRight: 8,
  },
  errorText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '500',
  },
}));

export default DriverInboxScreen;