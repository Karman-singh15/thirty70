"use client";

import { useEffect, useRef, useState } from "react";
import { Header } from "@/components/Header";
import { RoomHeader } from "@/components/RoomHeader";
import { ProblemSearch } from "@/components/ProblemSearch";
import { ProblemPanel } from "@/components/ProblemPanel";
import { CodeEditor } from "@/components/CodeEditor";
import { TurnBar } from "@/components/TurnBar";
import { ParticipantsPanel } from "@/components/ParticipantsPanel";
import { ResizeHandle } from "@/components/ResizeHandle";
import { TopProgressBar } from "@/components/TopProgressBar";
import { RoomBootLoader } from "@/components/RoomBootLoader";
import { getMaxParticipants } from "@/lib/roomLimits";
import { useRoom } from "@/hooks/useRoom";

const MIN_PROBLEM_WIDTH = 280;
const MAX_PROBLEM_WIDTH = 800;
const MIN_EDITOR_WIDTH = 360;
const MIN_PARTICIPANTS_WIDTH = 220;
const MAX_PARTICIPANTS_WIDTH = 520;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}


export default function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  // All room behaviour lives in the hook; what's left here is the pane layout
  // and the markup. Destructured rather than held as one object so the JSX
  // below reads exactly as it did before the split.
  const {
    room,
    myUserId,
    editor,
    shownProblem,
    problemLoading,
    canEdit,
    judgeBroadcast,
    judgeDismissed,
    setJudgeDismissed,
    myMicOn,
    myCameraOn,
    myCameraStream,
    mediaError,
    toggleMic,
    toggleCamera,
    remoteStreams,
    connectionStates,
    isPending,
    anyPending,
    handleProblemSelect,
    handleLanguageChange,
    handleJudge,
    handleLeaveRoom,
    handlePassTurn,
    handleSetTurnDuration,
    handleTogglePause,
    handleTurnExpired,
  } = useRoom(params);

  // Pane sizing is presentation, so it stays with the markup it drives.
  const [problemWidth, setProblemWidth] = useState(420);
  const [participantsWidth, setParticipantsWidth] = useState(320);
  const mainRowRef = useRef<HTMLDivElement | null>(null);
  const widthsInitialized = useRef(false);

  // Seed the panel widths from the room's actual size on first render, then
  // leave them alone — from here on out, sizing is entirely up to the user
  // dragging the handles. The three panes are not equals: the editor is what
  // people are actually looking at for the whole turn, so it opens with half
  // the row and the problem and participant columns split the rest. Reading
  // the problem and watching faces both work fine in a quarter each; writing
  // code in a third does not.
  useEffect(() => {
    if (widthsInitialized.current || !room || !mainRowRef.current) return;
    const totalWidth = mainRowRef.current.clientWidth;
    if (totalWidth > 0) {
      setProblemWidth(
        clamp(Math.round(totalWidth * 0.25), MIN_PROBLEM_WIDTH, MAX_PROBLEM_WIDTH)
      );
      setParticipantsWidth(
        clamp(Math.round(totalWidth * 0.25), MIN_PARTICIPANTS_WIDTH, MAX_PARTICIPANTS_WIDTH)
      );
    }
    widthsInitialized.current = true;
  }, [room]);

  if (!room) {
    // Deliberately the same screen the create flow shows, so arriving here
    // straight after "New Room" reads as one continuous wait rather than two
    // unrelated loading states. Both lines are observed, not timed: the
    // stream reports its own connection, and the snapshot arriving is what
    // ends this branch.
    return (
      <RoomBootLoader
        steps={[
          {
            id: "connect",
            label: "connecting to room",
            state: editor.connected ? "done" : "active",
          },
          {
            id: "sync",
            label: "syncing shared editor",
            state: editor.connected ? "active" : "pending",
          },
        ]}
      />
    );
  }

  const isOwner = !!myUserId && room.ownerId === myUserId;
  const readOnly = !canEdit;

  // Whose cursor we're showing, resolved to a name. Only the current writer
  // broadcasts one, so there is at most one at a time.
  const cursorOwner = editor.remoteCursor
    ? room.participants.find((p) => p.userId === editor.remoteCursor!.userId)
    : undefined;
  const writerLabel =
    editor.remoteCursor && cursorOwner
      ? {
          name: cursorOwner.name,
          lineNumber: editor.remoteCursor.lineNumber,
          column: editor.remoteCursor.column,
        }
      : null;

  return (
    // `h-dvh` locks the three-pane desktop layout to the viewport. On a phone
    // the panes stack, so the page has to be allowed to grow and scroll.
    <div className="flex min-h-dvh flex-col bg-canvas md:h-dvh">
      <Header />
      <TopProgressBar active={anyPending} />

      <RoomHeader
        roomName={room.name}
        inviteCode={room.inviteCode}
        participants={room.participants}
        onlineUserIds={room.onlineUserIds}
        micOn={room.micOn}
        cameraOn={room.cameraOn}
        maxParticipants={getMaxParticipants(room.ownerPlan)}
        myMicOn={myMicOn}
        myCameraOn={myCameraOn}
        mediaError={mediaError}
        onToggleMic={toggleMic}
        onToggleCamera={toggleCamera}
        onLeave={handleLeaveRoom}
        leavePending={isPending("leave")}
        isHost={isOwner}
      />

      <TurnBar
        participants={room.participants}
        turnOrder={room.turnOrder}
        currentTurnUserId={room.currentTurnUserId}
        turnNumber={room.turnNumber}
        turnEndsAt={room.turnEndsAt}
        turnPausedRemainingMs={room.turnPausedRemainingMs}
        turnDurationSeconds={room.turnDurationSeconds}
        myUserId={myUserId ?? null}
        isOwner={isOwner}
        hasProblem={!!room.problem}
        onPass={handlePassTurn}
        onChangeDuration={handleSetTurnDuration}
        onTogglePause={handleTogglePause}
        onTurnExpired={handleTurnExpired}
        passPending={isPending("pass")}
        pausePending={isPending("pause")}
        durationPending={isPending("duration")}
      />

      <div
        ref={mainRowRef}
        className="flex flex-1 flex-col border-t border-line md:flex-row md:overflow-hidden"
      >
        <div
          className="flex w-full flex-col md:w-[var(--problem-w)] md:shrink-0"
          style={{ "--problem-w": `${problemWidth}px` } as React.CSSProperties}
        >
          <div className="border-b border-line p-3">
            {isOwner ? (
              <ProblemSearch onSelect={handleProblemSelect} />
            ) : (
              <p className="text-xs text-muted">Only the host can pick a problem.</p>
            )}
          </div>
          <div className="flex-1 overflow-hidden">
            <ProblemPanel problem={shownProblem} loading={problemLoading} />
          </div>
        </div>

        <ResizeHandle
          onResize={(deltaX) =>
            setProblemWidth((w) => clamp(w + deltaX, MIN_PROBLEM_WIDTH, MAX_PROBLEM_WIDTH))
          }
        />

        <div
          className="flex h-[65dvh] flex-col overflow-hidden border-t border-line md:h-auto md:min-w-[var(--editor-min)] md:flex-1 md:border-t-0"
          style={{ "--editor-min": `${MIN_EDITOR_WIDTH}px` } as React.CSSProperties}
        >
          <CodeEditor
            language={editor.language}
            onLanguageChange={handleLanguageChange}
            onEditorMount={editor.attach}
            readOnly={readOnly}
            writerLabel={writerLabel}
            connected={editor.connected}
            canJudge={!!shownProblem}
            onRun={() => handleJudge("run")}
            onSubmit={() => handleJudge("submit")}
            judgeState={judgeDismissed ? null : judgeBroadcast}
            isJudgeSelf={judgeBroadcast?.userId === myUserId}
            onCloseJudge={() => setJudgeDismissed(true)}
          />
        </div>

        <ResizeHandle
          onResize={(deltaX) =>
            setParticipantsWidth((w) =>
              clamp(w - deltaX, MIN_PARTICIPANTS_WIDTH, MAX_PARTICIPANTS_WIDTH)
            )
          }
        />

        <div
          className="w-full border-t border-line md:w-[var(--participants-w)] md:shrink-0 md:border-l md:border-t-0"
          style={{ "--participants-w": `${participantsWidth}px` } as React.CSSProperties}
        >
          <ParticipantsPanel
            participants={room.participants}
            onlineUserIds={room.onlineUserIds}
            micOn={room.micOn}
            cameraOn={room.cameraOn}
            myUserId={myUserId ?? null}
            myCameraStream={myCameraStream}
            remoteStreams={remoteStreams}
            connectionStates={connectionStates}
          />
        </div>
      </div>
    </div>
  );
}
