import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { auth, db } from '../config/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

const AuthDebugger = () => {
  const [authStatus, setAuthStatus] = useState('Unknown');
  const [firestoreStatus, setFirestoreStatus] = useState('Unknown');
  const [userInfo, setUserInfo] = useState(null);

  useEffect(() => {
    // Check authentication status
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setAuthStatus('Authenticated');
        setUserInfo({
          uid: user.uid,
          email: user.email,
          emailVerified: user.emailVerified
        });
        
        // Test Firestore access
        testFirestoreAccess(user.uid);
      } else {
        setAuthStatus('Not Authenticated');
        setUserInfo(null);
        setFirestoreStatus('Unknown');
      }
    });

    return () => unsubscribe();
  }, []);

  const testFirestoreAccess = async (uid) => {
    try {
      console.log('Testing Firestore access for user:', uid);
      
      // Test reading driver document
      const driverRef = doc(db, 'Drivers', uid);
      const driverSnap = await getDoc(driverRef);
      
      if (driverSnap.exists()) {
        console.log('✅ Driver document exists and readable');
        setFirestoreStatus('Read Access OK');
      } else {
        console.log('⚠️ Driver document does not exist');
        setFirestoreStatus('Document Not Found');
      }
      
      // Test writing to a test document
      const testRef = doc(db, 'test', uid);
      await setDoc(testRef, {
        test: true,
        timestamp: new Date(),
        uid: uid
      });
      console.log('✅ Write access OK');
      setFirestoreStatus('Read/Write Access OK');
      
    } catch (error) {
      console.error('❌ Firestore access error:', error);
      setFirestoreStatus(`Error: ${error.message}`);
    }
  };

  const testLogin = async () => {
    try {
      // This is just for testing - you'll need to provide actual credentials
      Alert.alert('Test Login', 'Please use the login screen to test authentication');
    } catch (error) {
      Alert.alert('Login Error', error.message);
    }
  };

  const testFirestore = async () => {
    if (!auth.currentUser) {
      Alert.alert('Not Authenticated', 'Please login first');
      return;
    }
    
    await testFirestoreAccess(auth.currentUser.uid);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🔧 Auth & Firestore Debugger</Text>
      
      <View style={styles.statusContainer}>
        <Text style={styles.label}>Authentication Status:</Text>
        <Text style={[styles.status, authStatus === 'Authenticated' ? styles.success : styles.error]}>
          {authStatus}
        </Text>
      </View>
      
      <View style={styles.statusContainer}>
        <Text style={styles.label}>Firestore Status:</Text>
        <Text style={[styles.status, firestoreStatus.includes('OK') ? styles.success : styles.error]}>
          {firestoreStatus}
        </Text>
      </View>
      
      {userInfo && (
        <View style={styles.userInfo}>
          <Text style={styles.label}>User Info:</Text>
          <Text style={styles.info}>UID: {userInfo.uid}</Text>
          <Text style={styles.info}>Email: {userInfo.email}</Text>
          <Text style={styles.info}>Verified: {userInfo.emailVerified ? 'Yes' : 'No'}</Text>
        </View>
      )}
      
      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.button} onPress={testLogin}>
          <Text style={styles.buttonText}>Test Login</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.button} onPress={testFirestore}>
          <Text style={styles.buttonText}>Test Firestore</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    margin: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  statusContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
  status: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  success: {
    color: '#4CAF50',
  },
  error: {
    color: '#F44336',
  },
  userInfo: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 6,
  },
  info: {
    fontSize: 12,
    marginTop: 4,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 16,
  },
  button: {
    backgroundColor: '#2196F3',
    padding: 12,
    borderRadius: 6,
    minWidth: 100,
  },
  buttonText: {
    color: '#fff',
    textAlign: 'center',
    fontWeight: '600',
  },
});

export default AuthDebugger; 