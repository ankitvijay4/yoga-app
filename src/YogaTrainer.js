import React, { useState, useRef, useEffect, useCallback } from "react";
import Webcam from "react-webcam";

// Mapping pose part names to their keypoint indices
const partToIndex = {
  nose: 0,
  left_eye_inner: 1,
  left_eye: 2,
  left_eye_outer: 3,
  right_eye_inner: 4,
  right_eye: 5,
  right_eye_outer: 6,
  left_ear: 7,
  right_ear: 8,
  mouth_left: 9,
  mouth_right: 10,
  left_shoulder: 11,
  right_shoulder: 12,
  left_elbow: 13,
  right_elbow: 14,
  left_wrist: 15,
  right_wrist: 16,
  left_pinky: 17,
  right_pinky: 18,
  left_index: 19,
  right_index: 20,
  left_thumb: 21,
  right_thumb: 22,
  left_hip: 23,
  right_hip: 24,
  left_knee: 25,
  right_knee: 26,
  left_ankle: 27,
  right_ankle: 28,
  left_heel: 29,
  right_heel: 30,
  left_foot_index: 31,
  right_foot_index: 32,
};

const YogaTrainer = () => {
  const [keypoints, setKeypoints] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [isInstructorLarge, setIsInstructorLarge] = useState(false);
  const [poseName, setPoseName] = useState("");
  const [score, setScore] = useState(null);
  const [status, setStatus] = useState("");
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);

  const isSending = useRef(false);
  const pendingFrame = useRef(null);
  const lastSpokenMessage = useRef(null);

  const dataURItoBlob = useCallback((dataURI) => {
    const byteString = atob(dataURI.split(",")[1]);
    const mimeString = dataURI.split(",")[0].split(":")[1].split(";")[0];
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: mimeString });
  }, []);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const pose = urlParams.get("pose") || "";
    setPoseName(pose);
    console.log("Set poseName:", pose); // Debug poseName setting
  }, []);

 useEffect(() => {
  if (!feedback.length) return;

  const firstMessage = feedback[0]?.message;
  if (!firstMessage || firstMessage === "✅ Tree Pose: Perfect alignment!") return;

  const now = Date.now();

  // Initialize or update spoken message tracking
  if (
    !lastSpokenMessage.current ||
    lastSpokenMessage.current.message !== firstMessage
  ) {
    // New posture issue — reset and speak
    lastSpokenMessage.current = { message: firstMessage, count: 1, lastSpokenTime: now };
  } else if (lastSpokenMessage.current.count < 2) {
    // Same message — speak again only if spoken less than twice
    lastSpokenMessage.current.count += 1;
    lastSpokenMessage.current.lastSpokenTime = now;
  } else {
    // Spoken enough times
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(firstMessage);
  utterance.lang = "en-US";
  utterance.rate = 1;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}, [feedback]);


  const sendToBackend = useCallback(
    async (frame) => {
      if (!poseName) {
        console.warn("No pose name specified, skipping backend request. Current poseName:", poseName);
        return;
      }
      if (isSending.current) {
        pendingFrame.current = frame;
        return;
      }
      isSending.current = true;
      pendingFrame.current = null;

      try {
        const blob = dataURItoBlob(frame);
        const formData = new FormData();
        formData.append("file", blob, "frame.jpg");

       const url = `http://127.0.0.1:8001/process_image/?pose_name=${encodeURIComponent(poseName)}`;
        console.log("Request URL:", url); // Debug the actual URL
        const response = await fetch(url, {
          method: "POST",
          body: formData,
        });

        if (!response.ok) throw new Error(`Backend request failed with status ${response.status}`);

        const data = await response.json();
        console.log("Backend response:", data);

        const newFeedback = data.feedback || [];
           // ✅ NEW: set score and status
        setScore(data.score || null);
        setStatus(data.status || "");


        // Filter out duplicate messages

        // Deduplicate based on message and keypoint_index if exists
           const uniqueMessages = new Set();
        const uniqueFeedback = [];

        for (const item of newFeedback) {
          if (!uniqueMessages.has(item.message)) {
            uniqueMessages.add(item.message);
            uniqueFeedback.push(item);
          }
        }

        setFeedback(uniqueFeedback);

        //setFeedback(newFeedback);

        const mappedKeypoints = (data.keypoints || []).map((kp, idx) => {
          const fbItem = newFeedback.find((f) => f.keypoint_index === idx);
          return {
            ...kp,
            part: Object.keys(partToIndex).find((key) => partToIndex[key] === idx),
            feedbackMessage: fbItem ? fbItem.message : null,
          };
        });

        setKeypoints(mappedKeypoints);
      } catch (error) {
        console.error("Error sending frame to backend:", error);
      } finally {
        isSending.current = false;
        if (pendingFrame.current) {
          const nextFrame = pendingFrame.current;
          pendingFrame.current = null;
          sendToBackend(nextFrame);
        }
      }
    },
    [dataURItoBlob, poseName]
  );

  useEffect(() => {
    let isActive = true;

    const processFrame = async () => {
      if (!isActive || !webcamRef.current) return;

      const imageSrc = webcamRef.current.getScreenshot();
      if (imageSrc) {
        await sendToBackend(imageSrc);
      }

      if (isActive) {
        requestAnimationFrame(processFrame);
      }
    };

    processFrame();

    return () => {
      isActive = false;
      window.speechSynthesis.cancel();
    };
  }, [sendToBackend]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = webcamRef.current?.video;
    if (!canvas || !video) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setLineDash([]);
    ctx.textBaseline = "top";

    keypoints.forEach(({ x, y, part, correct }) => {
      if (!correct) {
        const cx = x * canvas.width;
        const cy = y * canvas.height;

        ctx.strokeStyle = "red";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - 10, cy);
        ctx.lineTo(cx + 10, cy);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, 2 * Math.PI);
        ctx.fillStyle = "red";
        ctx.fill();

        ctx.strokeRect(cx - 12, cy - 12, 24, 24);
      }
    });

    feedback.forEach(({ from_part, to_part }) => {
      if (from_part && to_part) {
        const fromIdx = partToIndex[from_part];
        const toIdx = partToIndex[to_part];

        const fromKP = keypoints[fromIdx];
        const toKP = keypoints[toIdx];

        if (fromKP && toKP) {
          const x1 = fromKP.x * canvas.width;
          const y1 = fromKP.y * canvas.height;
          const x2 = toKP.x * canvas.width;
          const y2 = toKP.y * canvas.height;

          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.strokeStyle = "orange";
          ctx.lineWidth = 3;
          ctx.setLineDash([6, 4]);
          ctx.stroke();
        }
      }
    });
  }, [keypoints, feedback]);

  const showThumbsUp = feedback.some((f) => f.message === "Good posture! Keep it up.");

  const handleToggle = (e) => {
    e.preventDefault();
    setIsInstructorLarge((prev) => !prev);
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "20px",
        backgroundColor: "#f7f7f7",
        height: "100vh",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <style>{`
        @keyframes pop {
          0% { transform: scale(0.8) translate(-50%, -50%); opacity: 0; }
          50% { transform: scale(1.1) translate(-50%, -50%); opacity: 1; }
          100% { transform: scale(1) translate(-50%, -50%); opacity: 1; }
        }
      `}</style>

      <div
        style={{
          width: "100%",
          maxWidth: "1600px",
          position: "relative",
          height: "calc(100% - 60px)",
        }}
      >
      {poseName && (
  <div
    style={{
      position: "absolute",
      top: 10,
      left: 10,
      backgroundColor: "#7b1fa2",
      color: "white",
      padding: "8px 16px",
      borderRadius: "20px",
      fontWeight: 600,
      fontSize: "1rem",
      zIndex: 15,
      boxShadow: "0 4px 10px rgba(0, 0, 0, 0.2)",
      userSelect: "none",
    }}
  >
    Pose: {poseName.replace(/_/g, " ")}
  </div>
)}


{score !== null && (
  <div
    style={{
      position: "absolute",
      top: 10,
      left: "50%",
      transform: "translateX(-50%)",
      background: "rgba(0, 0, 0, 0.7)",
      color: "#fff",
      padding: "12px 24px",
      borderRadius: "10px",
      textAlign: "center",
      zIndex: 15,
      fontSize: "1.1rem",
      lineHeight: "1.4",
      boxShadow: "0 0 10px rgba(0,0,0,0.5)",
      minWidth: "200px",
    }}
  >
    <div><strong>Status:</strong> {status}</div>
    <div><strong>Score:</strong> {score.toFixed(1)}</div>
  </div>
)}


{feedback.length > 0 && (
  <div
    style={{
      position: "absolute",
      top: 50,
      left: 10,
      maxWidth: 300,
      backgroundColor: "rgba(0,0,0,0.7)",
      color: "white",
      padding: "10px 15px",
      borderRadius: 6,
      fontSize: 14,
      zIndex: 15,
      userSelect: "none",
      maxHeight: "40vh",
      overflowY: "auto",
      boxShadow: "0 0 10px rgba(0,0,0,0.5)",
    }}
  >
    {feedback.map((f, i) => (
      <div key={i} style={{ marginBottom: "6px" }}>
        {f.message}
      </div>
    ))}
  </div>
)}

        <div
          style={{
            position: isInstructorLarge ? "absolute" : "relative",
            bottom: isInstructorLarge ? "10px" : undefined,
            right: isInstructorLarge ? "10px" : undefined,
            width: isInstructorLarge ? "126px" : "100%",
            height: isInstructorLarge ? "108px" : "100%",
            zIndex: isInstructorLarge ? 10 : 1,
            cursor: "pointer",
          }}
          onDoubleClick={handleToggle}
          title="Double click to toggle size"
        >
          <div style={{ position: "relative", width: "100%", height: "100%" }}>
            <Webcam
              audio={false}
              ref={webcamRef}
              screenshotFormat="image/webp"
              screenshotQuality={0.4}
              style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 8 }}
              videoConstraints={{ facingMode: "user", aspectRatio: 4 / 3 }}
            />
            <canvas
              ref={canvasRef}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                pointerEvents: "none",
                zIndex: 5,
              }}
            />
            {showThumbsUp && (
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  zIndex: 20,
                  fontSize: "80px",
                  color: "green",
                  animation: "pop 0.8s ease-in-out",
                  userSelect: "none",
                }}
              >
                <span>👍</span>
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            position: isInstructorLarge ? "relative" : "absolute",
            bottom: isInstructorLarge ? undefined : "10px",
            right: isInstructorLarge ? undefined : "10px",
            width: isInstructorLarge ? "100%" : "126px",
            height: isInstructorLarge ? "100%" : "108px",
            zIndex: isInstructorLarge ? 1 : 10,
            cursor: "pointer",
          }}
          onDoubleClick={handleToggle}
          title="Double click to toggle size"
        >
          <video
            src="/Test1.mp4"
            autoPlay
            muted
            controls
            style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 8 }}
          />
        </div>
      </div>
    </div>
  );
};

export default YogaTrainer;