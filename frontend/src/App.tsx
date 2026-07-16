import { Route, Routes } from "react-router-dom";

import { WorkspaceJoinScreen } from "./components/workspace/WorkspaceJoinScreen";
import { WorkspaceLayout } from "./components/workspace/WorkspaceLayout";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<WorkspaceJoinScreen />} />
      <Route path="/w/:code" element={<WorkspaceLayout />} />
    </Routes>
  );
}
