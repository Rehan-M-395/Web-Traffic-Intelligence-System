import { useEffect, useState } from "react";

export default function VisitorTracker() {
  const [visitors, setVisitors] = useState([]);
  const [myIP, setMyIP] = useState("");

  // record visit
  useEffect(() => {
    fetch("http://localhost:5000/api/visit")
      .then(res => res.json())
      .then(data => setMyIP(data.yourIP));

    loadVisitors();
  }, []);

  // load all visitors
  const loadVisitors = () => {
    fetch("http://localhost:5000/api/visitors")
      .then(res => res.json())
      .then(setVisitors);
  };

  return (
    <div style={styles.container}>
      <h1>Website Visitors</h1>

      <div style={styles.myip}>
        Your IP: <b>{myIP}</b>
      </div>

      <table style={styles.table}>
        <thead>
          <tr>
            <th>#</th>
            <th>IP Address</th>
            <th>Visit Time</th>
          </tr>
        </thead>

        <tbody>
          {visitors.map((v, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>{v.ip}</td>
              <td>{v.time}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const styles = {
  container: {
    width: "700px",
    margin: "50px auto",
    fontFamily: "Arial",
    textAlign: "center"
  },
  myip: {
    marginBottom: "20px",
    fontSize: "20px"
  },
  table: {
    width: "100%",
    borderCollapse: "collapse"
  }
};