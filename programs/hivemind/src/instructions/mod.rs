// Re-export all instruction modules so they can be used from lib.rs
// without needing to qualify the full path.
pub mod initialize_colony;
pub mod register_agent;
pub mod agent_pay;
pub mod report_outcome;
pub mod emergency_freeze;

pub use initialize_colony::*;
pub use register_agent::*;
pub use agent_pay::*;
pub use report_outcome::*;
pub use emergency_freeze::*;
