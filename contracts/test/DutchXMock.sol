pragma solidity ^0.4.25;


contract DutchXMock {

    address public lastCaller;

    function test(address _addr) public returns(bool) {
        require(msg.sender == _addr,"the caller must be equal to _addr");
        lastCaller = _addr;
        return true;
    }
}
