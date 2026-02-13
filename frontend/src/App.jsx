import { Routes, Route, Link } from "react-router-dom";
import VisitorTracker from "./VisitorTracker";
import Home from "./Home";

function App() {
  return (
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/visitors" element={<VisitorTracker/>} />
      </Routes>
  );
}

export default App;