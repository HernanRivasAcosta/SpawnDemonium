pub trait Encode {
    fn encode(&self, buf: &mut Vec<u8>);
}

pub trait Decode: Sized {
    fn decode(data: &[u8], offset: &mut usize) -> Self;
}

impl Encode for u8 {
    fn encode(&self, buf: &mut Vec<u8>) {
        buf.push(*self);
    }
}

impl Encode for u32 {
    fn encode(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.to_be_bytes());
    }
}

impl Encode for i32 {
    fn encode(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.to_be_bytes());
    }
}

impl Encode for i8 {
    fn encode(&self, buf: &mut Vec<u8>) {
        buf.push(*self as u8);
    }
}

impl Encode for bool {
    fn encode(&self, buf: &mut Vec<u8>) {
        buf.push(*self as u8);
    }
}

impl Decode for u8 {
    fn decode(data: &[u8], offset: &mut usize) -> Self {
        let v = data[*offset];
        *offset += 1;
        v
    }
}

impl Decode for u32 {
    fn decode(data: &[u8], offset: &mut usize) -> Self {
        let v = Self::from_be_bytes(data[*offset..*offset + 4].try_into().unwrap());
        *offset += 4;
        v
    }
}

impl Decode for i32 {
    fn decode(data: &[u8], offset: &mut usize) -> Self {
        let v = Self::from_be_bytes(data[*offset..*offset + 4].try_into().unwrap());
        *offset += 4;
        v
    }
}

impl Decode for i8 {
    fn decode(data: &[u8], offset: &mut usize) -> Self {
        let v = data[*offset] as i8;
        *offset += 1;
        v
    }
}

impl Decode for bool {
    fn decode(data: &[u8], offset: &mut usize) -> Self {
        let v = data[*offset] != 0;
        *offset += 1;
        v
    }
}
