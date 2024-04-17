import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { Accelerometer } from 'expo-sensors';
import * as Location from 'expo-location';
import { Camera } from 'expo-camera';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';

const AccelerometerData = () => {
  const [hasPermission, setHasPermission] = useState(null);
  const [acceleration, setAcceleration] = useState({ x: 0, y: 0, z: 0 });
  const [location, setLocation] = useState(null);
  const [disturbances, setDisturbances] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [videoUri, setVideoUri] = useState('');
  const [videoStartTime, setVideoStartTime] = useState(null);
  const cameraRef = useRef(null);

  useEffect(() => {
    (async () => {
      const { status: cameraStatus } = await Camera.requestCameraPermissionsAsync();
      const { status: locationStatus } = await Location.requestForegroundPermissionsAsync();
      const { status: accelStatus } = await Accelerometer.requestPermissionsAsync();
      setHasPermission(cameraStatus === 'granted' && locationStatus === 'granted' && accelStatus === 'granted');

      if (hasPermission) {
        Accelerometer.setUpdateInterval(500);
        const accelSubscription = Accelerometer.addListener(accelerationData => {
          setAcceleration(accelerationData);
          if (isRecording) detectDisturbance(accelerationData);
        });

        return () => accelSubscription.remove();
      }
    })();
  }, [hasPermission, isRecording]);

  const detectDisturbance = ({ x, y, z }) => {
    const magnitude = Math.sqrt(x ** 2 + y ** 2 + z ** 2);
    const disturbanceThreshold = 1.25;
    if (magnitude > disturbanceThreshold && location) {
      const timestamp = new Date().getTime() - videoStartTime;
      setDisturbances(prevDisturbances => [...prevDisturbances, { timestamp, location }]);
    }
  };

  useEffect(() => {
    (async () => {
      if (hasPermission) {
        const locationSubscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 1000 },
          (newLocation) => {
            setLocation(newLocation.coords);
          }
        );

        return () => locationSubscription.remove();
      }
    })();
  }, [hasPermission]);

  const handleStartRecording = async () => {
    if (cameraRef.current) {
      setIsRecording(true);
      const video = await cameraRef.current.recordAsync();
      setVideoUri(video.uri); // Set the video URI
      setVideoStartTime(new Date().getTime());
    }
  };

  const handleStopRecording = async () => {
    if (cameraRef.current) {
      cameraRef.current.stopRecording();
      setIsRecording(false);
      await saveDisturbancesToFile();
      await moveVideoFile();
    }
  };

  const ensureDirExists = async (dirUri) => {
    const dirInfo = await FileSystem.getInfoAsync(dirUri);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(dirUri, { intermediates: true });
    }
  };

  const saveDisturbancesToFile = async () => {
    const dirUri = FileSystem.documentDirectory + 'ILGC_Potholes/';
    await ensureDirExists(dirUri);

    const filePath = `${dirUri}disturbances_${new Date().toISOString()}.txt`;
    let content = disturbances.map(d => `Time: ${d.timestamp}, Location: Lat ${d.location.latitude}, Lon ${d.location.longitude}`).join('\n');
    await FileSystem.writeAsStringAsync(filePath, content);
    console.log('Disturbances saved to', filePath);
    return filePath; // Return the file path for sharing
  };

  const moveVideoFile = async () => {
    const dirUri = FileSystem.documentDirectory + 'ILGC_Potholes/';
    await ensureDirExists(dirUri);

    const newVideoUri = `${dirUri}video_${new Date().toISOString()}.mov`;
    await FileSystem.moveAsync({
      from: videoUri,
      to: newVideoUri,
    });
    console.log(`Video saved to: ${newVideoUri}`);
    return newVideoUri; // Return the new video URI for sharing
  };

  const shareFile = async (fileUri) => {
    if (!(await Sharing.isAvailableAsync())) {
      alert('Sharing is not available on your device');
      return;
    }

    await Sharing.shareAsync(fileUri);
  };

  const shareVideo = async () => {
    try {
      if (!(await Sharing.isAvailableAsync())) {
        alert('Sharing is not available on your device');
        return;
      }
  
      // Ensure MEDIA_LIBRARY permission is granted
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        alert('Permission to access media library was denied');
        return;
      }
  
      // Save the video to the gallery
      const asset = await MediaLibrary.createAssetAsync(videoUri);
      await MediaLibrary.createAlbumAsync('ILGC_Potholes', asset, false);
  
      // Share the video
      await Sharing.shareAsync(asset.uri);
    } catch (error) {
      console.error('Error sharing video:', error);
      alert('Error sharing video');
    }
  };

  if (hasPermission === null) {
    return <View style={styles.container}><Text>Requesting permissions...</Text></View>;
  }

  if (hasPermission === false) {
    return <View style={styles.container}><Text>No access to camera, location, or accelerometer</Text></View>;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>ILGC - Potholes and Disturbances</Text>
      <View style={styles.sensorContainer}>
        <Text style={styles.sensorTitle}>Accelerometer Data</Text>
        <View style={styles.sensorBox}>
          <Text style={styles.sensorText}>X: {acceleration.x.toFixed(3)}</Text>
          <Text style={styles.sensorText}>Y: {acceleration.y.toFixed(3)}</Text>
          <Text style={styles.sensorText}>Z: {acceleration.z.toFixed(3)}</Text>
        </View>
      </View>
      <ScrollView style={styles.scrollContainer}>
        {disturbances.map((dist, index) => (
          <Text key={index} style={styles.disturbanceData}>
            Disturbance at {formatTimestamp(dist.timestamp)}: Lat {dist.location.latitude.toFixed(6)}, Long {dist.location.longitude.toFixed(6)}
          </Text>
        ))}
      </ScrollView>
      <Camera ref={cameraRef} style={styles.cameraStyle} />
      <TouchableOpacity style={styles.button} onPress={isRecording ? handleStopRecording : handleStartRecording}>
        <Text style={styles.buttonText}>{isRecording ? "Stop Recording" : "Start Recording"}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.button} onPress={async () => {
        const filePath = await saveDisturbancesToFile();
        await shareFile(filePath);
      }}>
        <Text style={styles.buttonText}>Share Log</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.button} onPress={shareVideo}>
        <Text style={styles.buttonText}>Share Video</Text>
      </TouchableOpacity>
    </View>
  );
};

const formatTimestamp = (timestamp) => {
  const totalSeconds = Math.floor(timestamp / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  cameraStyle: {
    alignSelf: 'stretch',
    height: 200,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#000',
  },
  sensorContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  sensorTitle: {
    fontSize: 16,
    marginBottom: 10,
  },
  sensorBox: {
    borderWidth: 1,
    borderColor: '#000',
    borderRadius: 5,
    padding: 10,
  },
  sensorText: {
    fontSize: 14,
    marginBottom: 5,
  },
  scrollContainer: {
    maxHeight: 100,
    marginBottom: 20,
    width: '80%',
  },
  disturbanceData: {
    fontSize: 14,
    marginBottom: 10,
    color: 'red',
  },
  button: {
    backgroundColor: '#007878',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 5,
    marginBottom: 10,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
  },
});

export default AccelerometerData;
