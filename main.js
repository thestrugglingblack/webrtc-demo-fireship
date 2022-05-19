require('dotenv').config()
import './style.css'

import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
    apiKey: process.env.API_KEY,
    authDomain: process.env.AUTH_DOMAIN,
    projectId: process.env.PROJECT_ID,
    storageBucket: process.env.STORAGE_BUCKET,
    messagingSenderId: process.env.MESSAGING_SENDER_ID,
    appId: process.env.APP_ID,
    measurementId: process.env.MEASUREMENT_ID
};

if(!firebase.apps.length){
    firebase.initializeApp(firebaseConfig)
}

const firestore = firebase.firestore();

// List of stun servers
const servers = {
    iceServers: [
        {
            urls: ['stun:stun1.1.google.com:19302', 'stun:stun2.1.google.com:19302']
        }
    ],
    iceCandidatePoolSize: 10
}
// Global State ==> Useful when building interface within ReactJS or VueJS
let pc = new RTCPeerConnection(servers) // Managaes peer-to-peer connection
let localStream = null // Your webcam
let remoteStream = null // Your friend's webcam

const webcamButton = document.getElementById('webcamButton');
const webcamVideo = document.getElementById('webcamVideo')
const callButton = document.getElementById('callButton')
const callInput = document.getElementById('callInput')
const answerButton = document.getElementById('answerButton')
const remoteVideo = document.getElementById('remoteVideo')
const hangupButton = document.getElementById('hangupButton')


// 1. Setup media sources
webcamButton.onclick = async () => {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true})
    remoteStream = new MediaStream()

    // Push tracks from local stream to peer connection
    localStream.getTracks().forEach((track) => {
        pc.addTrack(track,localStream)
    })

    // Pull tracks from remote stream, add to video stream
    pc.ontrack = event => {
        event.streams[0].getTracks().forEach(track => {
            remoteStream.addTrack(track)
        })
    }

    webcamVideo.srcObject = localStream
    remoteVideo.srcObject = remoteStream
}

// 2. Create an offer
callButton.onclick = async () => {
    // Points to Firestone Collection and keeps tracks of the offers being made
    const callDoc = firestore.collection('calls').doc()
    const offerCandidates = callDoc.collection('offerCandidates')
    const answerCandidates = callDoc.collection('answerCandidates')

    callInput.value = callDoc.id

    // get candidates for caller and save to db. ICE candidate
    pc.onicecandidate = (event) => {
        event.candidate && offerCandidates.add(event.candidate.toJSON()) //event listener to listen to candidate save the data
    }

    // create off adn save to db
    const offerDescription = await pc.createOffer()
    await pc.setLocalDescription(offerDescription)

    // "sessions description protocol" is returned and then saved within the database.
    // SDP contains information about the protocol, session name, URI, email addresses, time zone, encryption key, media/transport address and etc.
    const offer = {
        sdp: offerDescription.sdp,
        type: offerDescription.type
    }

    await callDoc.set({offer})

    // now we need for an answer from the remote call by viewing changes from the document we saved in the db previously
    callDoc.onSnapshot((snapshot) => {
        const data = snapshot.data()

        if(!pc.currentRemoteDescription && data.answer) {
            const answerDescription = new RTCSessionDescription(data.answer)
            pc.setRemoteDescription(answerDescription)
        }
    })

    // When answered, add candidate to peer connection
    answerCandidates.onSnapshot( snapshot => {
        snapshot.docChanges().forEach((change) => {
            if(change.type === 'added'){
                const candidate = new RTCIceCandidate(change.doc.data())
                pc.addIceCandidate(candidate)
            }
        })

    })

}

// 3. Answer the call with the unique ID
answerButton.onclick = async () => {
    const callId = callInput.value;
    const callDoc = firestore.collection('calls').doc(callId);
    const answerCandidates = callDoc.collection('answerCandidates');
    const offerCandidates = callDoc.collection('offerCandidates');

    pc.onicecandidate = (event) => {
        event.candidate && answerCandidates.add(event.candidate.toJSON());
    };

    const callData = (await callDoc.get()).data();

    const offerDescription = callData.offer;
    await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

    const answerDescription = await pc.createAnswer();
    await pc.setLocalDescription(answerDescription);

    const answer = {
        type: answerDescription.type,
        sdp: answerDescription.sdp,
    };

    await callDoc.update({ answer });

    offerCandidates.onSnapshot((snapshot) => {
        snapshot.docChanges().forEach((change) => {
            console.log(change);
            if (change.type === 'added') {
                let data = change.doc.data();
                pc.addIceCandidate(new RTCIceCandidate(data));
            }
        });
    });
};
