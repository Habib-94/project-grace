import React from 'react';
import { Image, ImageSourcePropType, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  visible: boolean;
  title?: string;
  body?: string;
  imageSource?: ImageSourcePropType;
  onClose: () => void; // fallback close
  // new:
  onPrimary?: () => void; // primary button action (Next / Got it)
  primaryLabel?: string;
  size?: 'default' | 'small';
};

const defaultMascot = require('../../assets/images/mascot.png');

export default function TutorialModal({
  visible,
  title = '',
  body = '',
  imageSource,
  onClose,
  onPrimary,
  primaryLabel = 'Got it',
  size = 'default',
}: Props) {
  const src = imageSource ?? defaultMascot;
  const isSmall = size === 'small';

  const handlePrimary = () => {
    if (onPrimary) return onPrimary();
    return onClose();
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.inner, isSmall ? styles.innerSmall : null]}>
          <Image source={src} style={[styles.mascot, isSmall ? styles.mascotSmall : null]} resizeMode="contain" />

          <View style={[styles.textWrap, isSmall ? styles.textWrapSmall : null]}>
            {title ? <Text style={[styles.title, isSmall ? styles.titleSmall : null]}>{title}</Text> : null}
            <Text style={[styles.body, isSmall ? styles.bodySmall : null]}>{body}</Text>

            <View style={styles.actionWrap}>
              <Pressable onPress={handlePrimary} style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
                <Text style={styles.buttonText}>{primaryLabel}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  inner: {
    width: '92%',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: 'transparent',
  },
  innerSmall: {
    width: '86%',
    padding: 8,
  },
  mascot: {
    width: 120,
    height: 120,
    backgroundColor: 'transparent',
    marginRight: 12,
  },
  mascotSmall: {
    width: 80,
    height: 80,
    marginRight: 10,
  },
  textWrap: {
    flex: 1,
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  textWrapSmall: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
  },
  title: {
    color: '#052d40',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  titleSmall: {
    fontSize: 14,
    marginBottom: 4,
  },
  body: {
    color: '#222',
    fontSize: 14,
    lineHeight: 20,
  },
  bodySmall: {
    fontSize: 13,
    lineHeight: 18,
  },
  actionWrap: {
    marginTop: 10,
    alignItems: 'flex-end',
  },
  button: {
    backgroundColor: '#054f73',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: '#fff', fontWeight: '700' },
});