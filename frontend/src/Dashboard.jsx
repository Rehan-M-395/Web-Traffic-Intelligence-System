import { useEffect, useState } from "react";
import "./dashboard.css";

function formatInterval(obj) {
    if (!obj) return "0s";
    const { hours = 0, minutes = 0, seconds = 0 } = obj;
    return `${hours}h ${minutes}m ${seconds}s`;
}

export default function Dashboard() {
    const [stats, setStats] = useState(null);

    useEffect(() => {
        fetch("/api/stats")
            .then(r => r.json())
            .then(setStats);
    }, []);

    if (!stats) return <div className="loading">Loading analytics...</div>;

    return (
        <div className="container">
            <h1 className="title">📊 Analytics Dashboard</h1>

            <div className="cards">

                <div className="card online">
                    <h2>🟢 Online Users</h2>
                    <p className="big">{stats.online}</p>
                </div>

                <div className="card">
                    <h3>Total Users</h3>
                    <p className="big">{stats.users.total_users}</p>
                </div>

                <div className="card">
                    <h3>New Users</h3>
                    <p className="big">{stats.users.new_users}</p>
                </div>

                <div className="card">
                    <h3>Returning</h3>
                    <p className="big">{stats.users.returning_users}</p>
                </div>

                <div className="card">
                    <h3>Avg Session</h3>
                    <p className="big">{formatInterval(stats.avgSession)}</p>
                </div>

            </div>

            <div className="tableBox">
                <h2>📄 Top Pages</h2>
                <table>
                    <thead>
                        <tr>
                            <th>Path</th>
                            <th>Visits</th>
                        </tr>
                    </thead>
                    <tbody>
                        {stats.topPages.map(p => (
                            <tr key={p.path}>
                                <td>{p.path}</td>
                                <td>{p.visits}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}