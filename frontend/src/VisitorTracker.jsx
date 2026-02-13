import { useEffect, useState } from "react";

export default function Visitors() {
  const [visitors, setVisitors] = useState([]);
  const [myIP, setMyIP] = useState("");

  useEffect(() => {

    // prevent duplicate record in same tab
    const visited = sessionStorage.getItem("visited");

    if (!visited) {
      fetch("http://localhost:5000/api/visit")
        .then(res => res.json())
        .then(data => setMyIP(data.yourIP));

      sessionStorage.setItem("visited", "true");
    }

    loadVisitors();

  }, []);

  const loadVisitors = () => {
    fetch("http://localhost:5000/api/visitors")
      .then(res => res.json())
      .then(setVisitors);
  };

  return (
    <div style={styles.container}>
      <h1>Website Visitors</h1>

      <h3>Your IP: {myIP}</h3>

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
    textAlign: "center",
    fontFamily: "Arial"
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    marginTop: "20px"
  }
};